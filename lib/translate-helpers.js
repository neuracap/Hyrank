/**
 * EN→HI translator backed by DeepSeek (OpenAI-compatible Chat Completions API).
 *
 * Why DeepSeek instead of google-translate-api-x:
 *   - parallel-friendly (no per-IP throttle that trips on Promise.all bursts)
 *   - higher quality on exam-style prose + math-mixed text
 *   - one provider for all translation paths (this helper + /api/translate)
 *
 * Things kept verbatim (not sent through translation):
 *   - LaTeX / math: $...$, \(...\), \[...\], \command, \command{arg},
 *     \includegraphics{...}
 *   - Quoted strings: "X", 'X', curly “X” / ‘X’ — typically book/film/scheme
 *     names that should not be transliterated into Devanagari
 *   - Markdown italics: *X* / _X_
 *   - ALL-CAPS acronyms of length >= 2: RBI, ISRO, UPSC, GST, IAS, etc.
 *   - Bracketed section tags: [exam_craft], [answer_logic]
 *
 * The protected segments are swapped with __KEEP_<n>__ placeholders, the rest
 * is sent to DeepSeek, and the placeholders are restored on the response.
 */

const DEEPSEEK_MODEL = 'deepseek-v4-flash';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const REQUEST_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;

const PROTECT_PATTERNS = [
    /\[[a-z_]+\]/g,                              // [section_key]
    /\\includegraphics\{[^}]+\}/g,               // images
    /\$[^$]+\$/g,                                // $ math $
    /\\\([^)]+\\\)/g,                            // \( math \)
    /\\\[[^\]]+\\\]/g,                           // \[ math \]
    /\\[a-zA-Z]+(\{[^}]*\})?/g,                  // \cmd or \cmd{arg}
    /"[^"]+"/g,                                  // "Book Title"
    /'[^']{2,}'/g,                               // 'Book Title' (>=2 to skip apostrophes in 'don't')
    /[“][^”]+[”]/g,                              // “Book Title” (curly)
    /[‘][^’]+[’]/g,                              // ‘Book Title’ (curly)
    /\*[^*\n]+\*/g,                              // *italic*
    /\b[A-Z]{2,}\b/g,                            // ACRONYMS
];

const LANG_NAME = { en: 'English', hi: 'Hindi' };

function buildSystemPrompt(from, to) {
    const fromName = LANG_NAME[from] || from;
    const toName = LANG_NAME[to] || to;
    return [
        `You translate ${fromName} to ${toName} for competitive-exam content (UPSC, SSC, Banking).`,
        `Output ONLY the ${toName} translation — no preface, no explanation, no surrounding quotes.`,
        'Preserve verbatim (do NOT translate, transliterate, reformat, or move):',
        '  • __KEEP_<number>__ tokens (keep spelling and digits identical)',
        '  • LaTeX / math: $...$, \\(...\\), \\[...\\], \\command, \\command{...}',
        '  • Markdown / image markup, URLs, file paths',
        '  • ALL-CAPS acronyms (RBI, ISRO, UPSC, GST, ...)',
        'Match the source punctuation: do not add or remove a trailing period.',
        'Preserve line breaks: keep paragraph breaks and bullet/list breaks exactly as in the source. Do NOT merge multiple lines into one paragraph.',
        'If the input is a single short token, return its natural translation only.',
    ].join('\n');
}

function getApiKey() {
    const k = process.env.DEEPSEEK_API_KEY;
    if (!k) throw new Error('DEEPSEEK_API_KEY is not set');
    return k;
}

async function callDeepSeek(systemPrompt, userPrompt) {
    const apiKey = getApiKey();

    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(DEEPSEEK_URL, {
                method: 'POST',
                signal: ctrl.signal,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: DEEPSEEK_MODEL,
                    temperature: 0,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user',   content: userPrompt },
                    ],
                }),
            });
            clearTimeout(t);

            if (!res.ok) {
                const body = await res.text().catch(() => '');
                // Retry transient 429 / 5xx
                if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
                    lastErr = new Error(`DeepSeek ${res.status}: ${body.slice(0, 200)}`);
                    await new Promise(r => setTimeout(r, 400 * attempt));
                    continue;
                }
                throw new Error(`DeepSeek ${res.status}: ${body.slice(0, 200)}`);
            }

            const j = await res.json();
            const content = j?.choices?.[0]?.message?.content;
            if (typeof content !== 'string') {
                throw new Error('DeepSeek returned no content');
            }
            return content;
        } catch (e) {
            clearTimeout(t);
            lastErr = e;
            // Network/abort errors — retry
            if (attempt < MAX_ATTEMPTS && (e.name === 'AbortError' || /fetch|network/i.test(e.message))) {
                await new Promise(r => setTimeout(r, 400 * attempt));
                continue;
            }
            throw e;
        }
    }
    throw lastErr || new Error('DeepSeek translate failed');
}

function stripWrappingQuotes(s) {
    const t = s.trim();
    if (t.length >= 2) {
        const first = t[0], last = t[t.length - 1];
        if ((first === '"' && last === '"') || (first === '“' && last === '”') || (first === "'" && last === "'")) {
            return t.slice(1, -1).trim();
        }
    }
    return t;
}

/**
 * Translate plain text with protection. Empty / whitespace input
 * returns '' without making a network call.
 *
 * translateText(text, { from, to }) is the generic entry point. The single-
 * argument translateToHindi(text) is a thin wrapper kept for callers that
 * always want EN → HI.
 */
export async function translateText(text, { from = 'en', to = 'hi' } = {}) {
    if (!text || !String(text).trim()) return '';

    const placeholders = [];
    const replacer = (match) => {
        placeholders.push(match);
        return ` __KEEP_${placeholders.length - 1}__ `;
    };

    let working = String(text);
    for (const pattern of PROTECT_PATTERNS) {
        working = working.replace(pattern, replacer);
    }

    let translated;
    try {
        translated = await callDeepSeek(buildSystemPrompt(from, to), working);
    } catch (e) {
        throw new Error(`DeepSeek translate failed: ${e.message}`);
    }

    translated = stripWrappingQuotes(translated);

    // Restore. The model may garble the placeholder slightly (case, spaces around
    // underscores) — match loosely.
    translated = translated.replace(/__\s*KEEP\s*_\s*(\d+)\s*__/gi, (m, n) => {
        const idx = parseInt(n, 10);
        return (idx >= 0 && idx < placeholders.length) ? placeholders[idx] : m;
    });
    // Preserve line breaks. The old `\s+ → ' '` collapse was flattening every
    // paragraph in the response into one block. Now: collapse only horizontal
    // whitespace, trim per-line, and cap consecutive blank lines at one.
    translated = translated
        .replace(/[^\S\n]+/g, ' ')                  // runs of spaces/tabs → single space
        .split('\n')
        .map(l => l.replace(/[^\S\n]+$/g, '').replace(/^[^\S\n]+/g, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')                 // collapse 3+ newlines → 2
        .trim();
    return translated;
}

export async function translateToHindi(text) {
    return translateText(text, { from: 'en', to: 'hi' });
}

/**
 * Convenience: translate an array of strings concurrently.
 * DeepSeek tolerates parallel calls — no need to sequentialize.
 */
export async function translateMany(strings) {
    return Promise.all(strings.map(translateToHindi));
}
