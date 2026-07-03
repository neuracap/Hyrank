/**
 * generate_video_scripts.js
 *
 * Reads docs/words.csv, sends each word to Gemini (gemini-3.1-pro-preview by default)
 * with the viral-Reels-voiceover prompt, and stores the returned transcript in the
 * `video_script` table. An admin reviewer later edits + approves it at /video-scripts.
 *
 * Prereqs:
 *   - Run scripts/sql/video_script.sql on Supabase first (creates the table).
 *   - GEMINI_API_KEY set in .env.local
 *
 * Usage:
 *   node scripts/generate_video_scripts.js                 # DRY RUN: reports what it would do
 *   node scripts/generate_video_scripts.js --apply         # generate + save (skips words already done)
 *   node scripts/generate_video_scripts.js --apply --force # regenerate every word (overwrites raw + resets to GENERATED)
 *   node scripts/generate_video_scripts.js --apply --limit 5   # only the first 5 pending words (good for a test run)
 *   node scripts/generate_video_scripts.js --apply --model gemini-2.5-pro   # override the model
 *
 * NOTE: the prompt below is intentionally kept in sync with lib/video-script.js
 *       (used by the /api/video-scripts/[id]/generate route). Edit both together.
 */

const fs = require('fs');
const path = require('path');
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
const WORDS_CSV = path.join(__dirname, '..', 'docs', 'words.csv');
const DELAY_MS = 1500; // gap between calls to stay under rate limits

// ---- The prompt (word interpolated at [INSERT WORD HERE]) --------------------
const PROMPT_TEMPLATE = `You are a world-class, superhit movie maker known for making content that is deeply emotional, memorable, and relatable. Because of some stroke of bad luck you lost a lot of money in the crypto bubble burst and you need to recover it fast and thought of making educational videos. But you are very honest to your craft and you want to make the best videos for your audience as you feel in it lies your redemption. Your task here is to act as an "Educational Creator" making viral 34-second Reels/Shorts voiceovers to teach difficult English vocabulary to students from a Hindi-speaking background.

Objective: Generate a punchy, engaging, and highly varied voiceover script for the English word: [INSERT WORD HERE].

Tone & Language Constraints:
1. The language must be conversational Hinglish.
2. CRUCIAL: Write all Hindi parts in Devanagari script and all English words in Roman script.
3. Tone should be high-energy, witty, and empathetic to Gen Z student struggles.
4. DO NOT include any B-roll descriptions, visual cues, timestamps, tags, or formatting. Only provide the exact spoken text in plain paragraphs.

Structural Requirements & Randomization (Read Carefully):
To ensure maximum variety across hundreds of scripts, you MUST randomly select a style for the Hook and the Story from the options below. Do not use the same combination every time.

1. THE RANDOMIZED HOOK:
Do NOT use filler intros (e.g., "Let's learn", "Stop saying"). Randomly start the video using ONE of these 4 styles:
- Style A (Pop-Culture Riddle): Describe a famous Bollywood/OTT character trope or viral meme naming the exact movie/character, and ask what word fits them. Rely on this more than B or C styles
- Style B (Savage Roast): Tell the viewer how to use this word to politely insult a specific annoying type of person (e.g., toxic relatives, fake friends).
- Style C (Relatable Kalesh): Start mid-action in a dramatic, everyday disaster (e.g., hostel fights, metro arguments).

2. WORD & MEANING INTRO:
Immediately after the hook, reveal the word and its simple English meaning seamlessly (e.g., "Word है [Word] और इसका meaning है [Meaning]").

3. THE MEMORY CUE:
Provide a quick, bizarre, or funny English sound-alike/rhyming trick to memorize it (e.g., for Termagant - "Terror Aunty").

4. THE DYNAMIC B-PLOT STORY (Randomized):
Create a fast 2-line story applying the word. Randomly choose the context:
- Context 1: A vague but instantly recognizable Indian pop-culture reference (e.g., a mastermind crime boss from a web series, an over-the-top Bollywood hero, a strict TV show mother-in-law).
- Context 2: A deeply relatable Gen Z situation (e.g., an exhausted backbencher, a corporate intern surviving a toxic boss, a serial dater).
Give characters a 2-3 word backstory. Use the "But/Therefore" narrative drive, but DO NOT literally use the words "but" or "therefore".

5. SYNONYMS & ANTONYMS:
Verbally list 1 synonym and contrast them with 1 antonym, flowing naturally as part of the script's rhythm, not as a boring list.

6. CLOSING:
End with a fast, witty one-liner related to the word that challenges the viewer or asks a quick question in the comments.`;

function buildPrompt(word) {
    return PROMPT_TEMPLATE.split('[INSERT WORD HERE]').join(word);
}

// ---- CSV parse (simple: "Sno,WORD" header, no quoting) ----------------------
function readWords() {
    const raw = fs.readFileSync(WORDS_CSV, 'utf8');
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = [];
    for (let i = 1; i < lines.length; i++) { // skip header
        const [sno, ...rest] = lines[i].split(',');
        const word = rest.join(',').trim();
        if (!word) continue;
        out.push({ sno: parseInt(sno, 10) || null, word });
    }
    return out;
}

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
    statement_timeout: 0,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function generateOne(genAI, word) {
    const model = genAI.getGenerativeModel({ model: MODEL });
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await model.generateContent({
                contents: [{ parts: [{ text: buildPrompt(word) }] }],
                generationConfig: { temperature: 1.0 }, // high temp -> more variety across words
            });
            const text = (result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            if (!text) throw new Error('Empty response from Gemini');
            return text;
        } catch (e) {
            if (attempt < MAX_RETRIES) {
                await sleep(1500 * (attempt + 1));
                continue;
            }
            throw e;
        }
    }
}

async function main() {
    if (!process.env.GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY is not set in .env.local');
        process.exit(1);
    }

    const words = readWords();
    console.log(`Loaded ${words.length} words from docs/words.csv`);
    console.log(`Model: ${MODEL}`);
    console.log(`Mode:  ${APPLY ? 'APPLY (will call Gemini + write DB)' : 'DRY RUN (no calls, no writes)'}${FORCE ? '  [--force: regenerate all]' : ''}`);

    // Which words already have a (non-failed) transcript?
    const existingRes = await pool.query(
        `SELECT lower(word) AS w, status FROM video_script`
    );
    const existing = new Map(existingRes.rows.map(r => [r.w, r.status]));

    // Decide the work list
    let pending = words.filter(({ word }) => {
        const status = existing.get(word.toLowerCase());
        if (FORCE) return true;
        if (status === undefined) return true;   // never generated
        if (status === 'FAILED') return true;    // retry failures
        return false;                            // already GENERATED/EDITED/APPROVED
    });
    if (LIMIT > 0) pending = pending.slice(0, LIMIT);

    console.log(`\n${pending.length} word(s) to generate` +
        (LIMIT > 0 ? ` (capped by --limit ${LIMIT})` : '') +
        `; ${words.length - pending.length} skipped (already done or out of range).\n`);

    if (!APPLY) {
        pending.slice(0, 20).forEach(p => console.log(`  would generate: ${p.word}`));
        if (pending.length > 20) console.log(`  ...and ${pending.length - 20} more`);
        console.log('\nDry run only. Re-run with --apply to generate + save.');
        await pool.end();
        return;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    let ok = 0, failed = 0;

    for (let i = 0; i < pending.length; i++) {
        const { word, sno } = pending[i];
        process.stdout.write(`[${i + 1}/${pending.length}] ${word} ... `);
        try {
            const transcript = await generateOne(genAI, word);
            // Upsert by lower(word). Seed both raw_transcript and the editable transcript.
            await pool.query(
                `INSERT INTO video_script (word, word_sno, raw_transcript, transcript, model, status, gen_error, updated_at)
                 VALUES ($1, $2, $3, $3, $4, 'GENERATED', NULL, NOW())
                 ON CONFLICT (lower(word)) DO UPDATE SET
                     word_sno       = EXCLUDED.word_sno,
                     raw_transcript = EXCLUDED.raw_transcript,
                     transcript     = EXCLUDED.transcript,
                     model          = EXCLUDED.model,
                     status         = 'GENERATED',
                     gen_error      = NULL,
                     reviewed_by    = NULL,
                     reviewed_at    = NULL,
                     updated_at     = NOW()`,
                [word, sno, transcript, MODEL]
            );
            ok++;
            console.log('ok');
        } catch (e) {
            failed++;
            console.log(`FAILED: ${e.message}`);
            // Record the failure so a retry run picks it up.
            await pool.query(
                `INSERT INTO video_script (word, word_sno, model, status, gen_error, updated_at)
                 VALUES ($1, $2, $3, 'FAILED', $4, NOW())
                 ON CONFLICT (lower(word)) DO UPDATE SET
                     status = 'FAILED', gen_error = EXCLUDED.gen_error, updated_at = NOW()`,
                [word, sno, MODEL, e.message]
            ).catch(() => {});
        }
        if (i < pending.length - 1) await sleep(DELAY_MS);
    }

    console.log(`\nDone. ${ok} generated, ${failed} failed.`);
    await pool.end();
}

main().catch(async (e) => {
    console.error('Fatal:', e);
    await pool.end().catch(() => {});
    process.exit(1);
});
