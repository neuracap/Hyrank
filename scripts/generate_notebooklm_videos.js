/**
 * generate_notebooklm_videos.js
 *
 * Automates the NotebookLM "Video Overview" step of the vocab Reels pipeline.
 * For each APPROVED script that doesn't yet have a video (prod_stage QUEUED/VIDEO,
 * video_url empty) it drives the `notebooklm` CLI (notebooklm-py) to:
 *
 *   1. create a notebook  "vocab-<sno>-<word>"
 *   2. add the romanized transcript (transcript_latin) as a TEXT source
 *      (NotebookLM's burned-in captions can't render Devanagari)
 *   3. generate a Video Overview (--format short) with our instructions prompt
 *   4. wait for completion and download the MP4 into --outdir
 *   5. update the DB row: prod_stage -> EDIT, video_url = local file path
 *
 * Every notebook-scoped CLI call passes an explicit `-n <notebook_id>`, so runs
 * are safe to parallelize — generation happens server-side, so N words at once
 * cuts wall-clock roughly by N.
 *
 * ── One-time setup ──────────────────────────────────────────────────────────
 *   pip install "notebooklm-py[browser]" gpsoauth   (we run the GitHub build: pip install -U "git+https://github.com/teng-lin/notebooklm-py")
 *   notebooklm login --master-token --account <acct>   # durable auth, self re-mints
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   node scripts/generate_notebooklm_videos.js                        # DRY RUN: list candidates
 *   node scripts/generate_notebooklm_videos.js --apply                # up to --limit (default 3), sequential
 *   node scripts/generate_notebooklm_videos.js --apply --limit 12 --parallel 5
 *   node scripts/generate_notebooklm_videos.js --apply --word abrogate
 *   node scripts/generate_notebooklm_videos.js --apply --format brief --style whiteboard
 *   node scripts/generate_notebooklm_videos.js --apply --cleanup      # delete each notebook after download
 *
 * NOTES
 *  - Daily video quota is account-tier dependent (Pro ≈ 20/day). Quota/auth errors
 *    stop the run cleanly; re-run picks up where it left off.
 *  - --format short ignores --style (the CLI rejects styles for short/cinematic).
 *  - notebooklm-py is an UNOFFICIAL client on undocumented Google APIs — if every
 *    call starts failing: pip install -U "git+https://github.com/teng-lin/notebooklm-py"
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const CLEANUP = process.argv.includes('--cleanup');

function argValue(flag, fallback) {
    const i = process.argv.indexOf(flag);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const LIMIT = parseInt(argValue('--limit', '3'), 10) || 3;
const PARALLEL = Math.max(1, Math.min(8, parseInt(argValue('--parallel', '1'), 10) || 1));
const ONLY_WORD = argValue('--word', null);
const FORMAT = argValue('--format', 'short');          // short | brief | explainer | cinematic
const STYLE = argValue('--style', null);               // only used for brief/explainer
const OUT_DIR = path.resolve(argValue('--outdir', path.join(__dirname, '..', 'notebooklm_videos')));
const GEN_TIMEOUT_S = parseInt(argValue('--timeout', '1800'), 10) || 1800;

// ── The video instructions sent to NotebookLM (edit freely, or pass --instructions) ──
const DEFAULT_INSTRUCTIONS =
    'make a word meaning video and stick to the exact script that is mentioned in the source';
const INSTRUCTIONS = argValue('--instructions', DEFAULT_INSTRUCTIONS);

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
    statement_timeout: 0,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── notebooklm CLI wrapper ───────────────────────────────────────────────────
// The CLI may be on PATH as `notebooklm`, or only reachable as `python -m notebooklm`
// (pip --user installs on Windows). Detect once at startup.
let NLM_BASE = null;
function resolveNlmBase() {
    for (const base of [['notebooklm'], ['python', '-m', 'notebooklm'], ['py', '-m', 'notebooklm']]) {
        // No `shell` here: .exe binaries spawn fine without it, and shell:true on
        // Windows concatenates args unescaped (breaks quoted titles/instructions).
        const probe = spawnSync(base[0], [...base.slice(1), '--version'], {
            encoding: 'utf8', timeout: 30000, windowsHide: true,
        });
        if (!probe.error && probe.status === 0) return base;
    }
    throw new Error('`notebooklm` CLI not found. Install it: pip install "notebooklm-py[browser]"  then: notebooklm login');
}

// Runs `notebooklm <args> --json` asynchronously, resolves the parsed JSON.
// Rejects with stderr on failure. Safe for concurrent calls (explicit -n args,
// no shared active-notebook state is touched).
function nlm(args, { input = undefined, timeoutMs = 120000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(NLM_BASE[0], [...NLM_BASE.slice(1), ...args, '--json'], {
            windowsHide: true,
            // Self-healing auth: headless re-auth from the persisted browser profile,
            // and automatic re-mint from master_token.json when present.
            env: { ...process.env, NOTEBOOKLM_HEADLESS_REAUTH: '1' },
        });
        let stdout = '', stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`notebooklm ${args[0]} ${args[1] || ''} timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.on('close', (code) => {
            clearTimeout(timer);
            const out = stdout.trim();
            if (code !== 0) {
                return reject(new Error(`notebooklm ${args[0]} ${args[1] || ''} failed (exit ${code}): ${(stderr || out || '').trim().slice(0, 600)}`));
            }
            try { return resolve(JSON.parse(out)); } catch { /* fall through */ }
            const m = out.match(/\{[\s\S]*\}/);
            if (m) { try { return resolve(JSON.parse(m[0])); } catch { /* fall through */ } }
            resolve({ raw: out });
        });
        if (input !== undefined) child.stdin.write(input);
        child.stdin.end();
    });
}

const sanitize = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();

// ── Transliteration fallback (Devanagari → romanized Hinglish) ───────────────
// Normally the reviewer generates transcript_latin on the review page; if it's
// missing we transliterate here and save it back.
// Prompt kept in sync with lib/video-script.js (transliterateToLatin).
const TRANSLITERATE_PROMPT = `You are transliterating a Hinglish voiceover script for an Indian audience.
The script mixes Hindi written in Devanagari and English words in Roman script.

TASK: Convert ALL Devanagari Hindi into romanized Hindi (Latin script), the way Indians casually type it (WhatsApp style). Examples: "याद है" → "yaad hai", "तुम्हारा" → "tumhara", "कर दिया" → "kar diya".

RULES:
1. Do NOT translate anything into English — only transliterate the sounds.
2. Keep every English word exactly as it is.
3. Keep punctuation, line breaks, and paragraph structure identical to the input.
4. Use simple readable spellings — no diacritics, no IAST (use "hai" not "hai̯", "zaroor" not "zarūr").
5. Return ONLY the transliterated script, no explanations, no markdown.

SCRIPT:
`;

async function transliterateToLatin(text) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('transcript_latin missing and GEMINI_API_KEY not set — cannot transliterate');
    }
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_VIDEO_MODEL || 'gemini-3.1-pro-preview' });
    const result = await model.generateContent({
        contents: [{ parts: [{ text: TRANSLITERATE_PROMPT + text }] }],
        generationConfig: { temperature: 0.1 },
    });
    const out = (result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!out) throw new Error('Empty transliteration response from Gemini');
    return out;
}

async function processWord(row) {
    const tag = row.word;
    const label = `${row.word_sno ?? '?'}-${row.word}`;
    const outFile = path.join(OUT_DIR, `${row.word_sno ?? 0}-${sanitize(row.word)}.mp4`);
    let notebookId = null;

    // Mark as VIDEO (generating) so the admin UI shows the right state during the run.
    await pool.query(
        `UPDATE video_script SET prod_stage = 'VIDEO', prod_updated_at = NOW()
         WHERE video_script_id = $1 AND prod_stage = 'QUEUED'`,
        [row.video_script_id]
    );

    try {
        // 0. Ensure the Latin (romanized) copy exists — that's what NotebookLM gets.
        let sourceText = (row.transcript_latin || '').trim();
        if (!sourceText) {
            console.log(`[${tag}] transliterating (no Latin copy yet)`);
            sourceText = await transliterateToLatin(row.transcript);
            await pool.query(
                `UPDATE video_script SET transcript_latin = $1, updated_at = NOW() WHERE video_script_id = $2`,
                [sourceText, row.video_script_id]
            );
        }

        // 1. Create notebook (no --use: explicit -n everywhere keeps parallel runs safe)
        const created = await nlm(['create', `vocab-${label}`]);
        notebookId = created.notebook?.id || created.id || created.active_notebook_id;
        if (!notebookId) throw new Error(`could not read notebook id from: ${JSON.stringify(created).slice(0, 300)}`);
        console.log(`[${tag}] notebook ${notebookId}`);

        // 2. Add the romanized transcript as a text source (stdin)
        await nlm(['source', 'add', '-', '--type', 'text', '--title', `${row.word} voiceover script`, '-n', notebookId],
            { input: sourceText });
        console.log(`[${tag}] source added, generating video (--format ${FORMAT}, up to ${Math.round(GEN_TIMEOUT_S / 60)} min)`);

        // 3. Generate the video overview and wait
        const genArgs = ['generate', 'video', INSTRUCTIONS, '--format', FORMAT, '-n', notebookId, '--wait', '--timeout', String(GEN_TIMEOUT_S)];
        if (STYLE && !['short', 'cinematic'].includes(FORMAT)) genArgs.push('--style', STYLE);
        await nlm(genArgs, { timeoutMs: (GEN_TIMEOUT_S + 120) * 1000 });

        // 4. Download the MP4
        await nlm(['download', 'video', outFile, '--latest', '--force', '-n', notebookId], { timeoutMs: 600000 });
        if (!fs.existsSync(outFile)) throw new Error(`download reported success but file missing: ${outFile}`);
        const mb = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(1);
        console.log(`[${tag}] downloaded ${outFile} (${mb} MB)`);

        // 5. Record in DB: video generated -> EDIT stage, local path as the video link
        await pool.query(
            `UPDATE video_script
             SET prod_stage = 'EDIT', video_url = $1,
                 prod_notes = TRIM(BOTH E'\\n' FROM COALESCE(prod_notes, '') || E'\\n' || $2),
                 prod_updated_at = NOW()
             WHERE video_script_id = $3`,
            [outFile, `NotebookLM video generated (notebook ${notebookId}, format ${FORMAT})`, row.video_script_id]
        );

        // 6. Optional cleanup
        if (CLEANUP && notebookId) {
            await nlm(['delete', '-n', notebookId, '-y']);
            console.log(`[${tag}] notebook deleted`);
        }
        return true;
    } catch (e) {
        console.error(`[${tag}] FAILED: ${e.message}`);
        // Leave the row in VIDEO stage with the error noted so the operator can see/retry.
        await pool.query(
            `UPDATE video_script
             SET prod_notes = TRIM(BOTH E'\\n' FROM COALESCE(prod_notes, '') || E'\\n' || $1),
                 prod_updated_at = NOW()
             WHERE video_script_id = $2`,
            [`NotebookLM generation FAILED: ${e.message.slice(0, 400)}`, row.video_script_id]
        ).catch(() => {});
        // Quota/auth errors mean the rest of the batch will fail too — signal the caller.
        if (/quota|rate.?limit|daily limit|429/i.test(e.message)) return 'QUOTA';
        if (/authentication expired|re-?authenticate|accounts\.google\.com/i.test(e.message)) return 'AUTH';
        return false;
    }
}

async function main() {
    // Candidates: approved scripts still needing a video.
    const params = [];
    let where = `status = 'APPROVED' AND prod_stage IN ('QUEUED', 'VIDEO') AND video_url IS NULL`;
    if (ONLY_WORD) {
        params.push(ONLY_WORD.toLowerCase());
        where += ` AND lower(word) = $${params.length}`;
    }
    const res = await pool.query(
        `SELECT video_script_id, word, word_sno, transcript, transcript_latin
         FROM video_script WHERE ${where}
         ORDER BY word_sno NULLS LAST, word`,
        params
    );
    const candidates = res.rows.filter(r => (r.transcript || '').trim());
    const batch = candidates.slice(0, LIMIT);

    console.log(`Format: ${FORMAT}${STYLE ? `, style: ${STYLE}` : ''}   Parallel: ${PARALLEL}   Output: ${OUT_DIR}`);
    console.log(`Mode:   ${APPLY ? 'APPLY' : 'DRY RUN (no NotebookLM calls, no writes)'}`);
    console.log(`\n${candidates.length} approved script(s) awaiting video; processing ${batch.length} this run (--limit ${LIMIT}).\n`);
    batch.forEach(r => console.log(`  ${APPLY ? 'will process' : 'would process'}: #${r.word_sno ?? '—'} ${r.word}`));

    if (!APPLY) {
        console.log('\nDry run only. Re-run with --apply to generate videos.');
        await pool.end();
        return;
    }
    if (batch.length === 0) { await pool.end(); return; }

    NLM_BASE = resolveNlmBase();

    // Fail fast if the CLI isn't installed / logged in.
    try {
        await nlm(['auth', 'check']);
    } catch (e) {
        console.error(`\nAuth check failed: ${e.message}`);
        console.error('Run: notebooklm login --master-token --account <acct>');
        await pool.end();
        process.exit(1);
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });

    // Worker pool: PARALLEL words in flight at once; staggered starts to be
    // gentle on rate limits. Quota/auth failure stops workers from pulling
    // new words (in-flight ones finish/fail on their own).
    const queue = [...batch];
    let ok = 0, failed = 0, stopReason = null;
    async function worker(i) {
        await sleep(i * 2000); // stagger initial fires
        while (queue.length > 0 && !stopReason) {
            const row = queue.shift();
            const result = await processWord(row);
            if (result === true) ok++;
            else {
                failed++;
                if (result === 'QUOTA' || result === 'AUTH') stopReason = result;
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, batch.length) }, (_, i) => worker(i)));

    if (stopReason === 'QUOTA') console.error('\nDaily NotebookLM video quota appears exhausted — stopped early. Re-run tomorrow.');
    if (stopReason === 'AUTH') console.error('\nNotebookLM auth failed and did not self-heal — stopped early. Re-login and re-run.');

    console.log(`\nDone. ${ok} video(s) generated, ${failed} failed.`);
    console.log(`Videos in: ${OUT_DIR}  (rows moved to EDIT stage with the local path as video link)`);
    await pool.end();
}

main().catch(async (e) => {
    console.error('Fatal:', e);
    await pool.end().catch(() => {});
    process.exit(1);
});
