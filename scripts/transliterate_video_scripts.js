/**
 * transliterate_video_scripts.js
 *
 * Fills transcript_latin (romanized Hinglish) for video_script rows that don't
 * have it yet, via Gemini. The Latin copy is what NotebookLM receives as the
 * video source (its burned-in captions can't render Devanagari).
 *
 * Prompt kept in sync with lib/video-script.js (transliterateToLatin) and
 * scripts/generate_notebooklm_videos.js. Edit together.
 *
 * Usage:
 *   node scripts/transliterate_video_scripts.js            # dry run: report counts
 *   node scripts/transliterate_video_scripts.js --apply    # transliterate all missing
 *   node scripts/transliterate_video_scripts.js --apply --limit 5
 *   node scripts/transliterate_video_scripts.js --apply --force   # redo ALL rows (overwrites edits!)
 */

const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
function argValue(flag, fallback) {
    const i = process.argv.indexOf(flag);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const LIMIT = parseInt(argValue('--limit', '0'), 10) || 0;
const MODEL = argValue('--model', process.env.GEMINI_VIDEO_MODEL || 'gemini-3.1-pro-preview');
const DELAY_MS = 1200;

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

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
    statement_timeout: 0,
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function transliterate(genAI, text) {
    const model = genAI.getGenerativeModel({ model: MODEL });
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await model.generateContent({
                contents: [{ parts: [{ text: TRANSLITERATE_PROMPT + text }] }],
                generationConfig: { temperature: 0.1 },
            });
            const out = (result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            if (!out) throw new Error('Empty response');
            return out;
        } catch (e) {
            if (attempt < MAX_RETRIES) { await sleep(1500 * (attempt + 1)); continue; }
            throw e;
        }
    }
}

async function main() {
    if (!process.env.GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY is not set in .env.local');
        process.exit(1);
    }
    const where = FORCE
        ? `transcript IS NOT NULL AND TRIM(transcript) <> ''`
        : `transcript IS NOT NULL AND TRIM(transcript) <> '' AND (transcript_latin IS NULL OR TRIM(transcript_latin) = '')`;
    const res = await pool.query(
        `SELECT video_script_id, word, word_sno, transcript FROM video_script
         WHERE ${where} ORDER BY word_sno NULLS LAST, word`
    );
    let pending = res.rows;
    if (LIMIT > 0) pending = pending.slice(0, LIMIT);

    console.log(`Model: ${MODEL}`);
    console.log(`Mode:  ${APPLY ? 'APPLY' : 'DRY RUN'}${FORCE ? ' [--force: redo all]' : ''}`);
    console.log(`${pending.length} row(s) to transliterate.\n`);
    if (!APPLY) {
        pending.slice(0, 10).forEach(p => console.log(`  would transliterate: ${p.word}`));
        if (pending.length > 10) console.log(`  ...and ${pending.length - 10} more`);
        console.log('\nDry run only. Re-run with --apply.');
        await pool.end();
        return;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    let ok = 0, failed = 0;
    for (let i = 0; i < pending.length; i++) {
        const { video_script_id, word, transcript } = pending[i];
        process.stdout.write(`[${i + 1}/${pending.length}] ${word} ... `);
        try {
            const latin = await transliterate(genAI, transcript);
            await pool.query(
                `UPDATE video_script SET transcript_latin = $1, updated_at = NOW() WHERE video_script_id = $2`,
                [latin, video_script_id]
            );
            ok++;
            console.log('ok');
        } catch (e) {
            failed++;
            console.log(`FAILED: ${e.message}`);
        }
        if (i < pending.length - 1) await sleep(DELAY_MS);
    }
    console.log(`\nDone. ${ok} transliterated, ${failed} failed.`);
    await pool.end();
}

main().catch(async (e) => {
    console.error('Fatal:', e);
    await pool.end().catch(() => {});
    process.exit(1);
});
