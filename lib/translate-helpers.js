import { translate } from 'google-translate-api-x';

/**
 * EN→HI translator with protection for things that should stay verbatim:
 *
 *   - LaTeX / math: $...$, \(...\), \[...\], \command, \command{arg},
 *     \includegraphics{...}
 *   - Quoted strings: "X", 'X', curly “X” / ‘X’ — typically book/film/scheme
 *     names that should not be transliterated into Devanagari
 *   - Markdown italics: *X* / _X_ — same rationale
 *   - ALL-CAPS acronyms of length >= 2: RBI, ISRO, UPSC, GST, IAS, etc.
 *   - Bracketed section tags: [exam_craft], [answer_logic]
 *
 * The protected segments are swapped with __KEEP_<n>__ placeholders, the rest
 * is sent to google-translate-api-x, and the placeholders are restored.
 */
const PROTECT_PATTERNS = [
    /\[[a-z_]+\]/g,                              // [section_key]
    /\\includegraphics\{[^}]+\}/g,               // images
    /\$[^$]+\$/g,                                // $ math $
    /\\\([^)]+\\\)/g,                            // \( math \)
    /\\\[[^\]]+\\\]/g,                           // \[ math \]
    /\\[a-zA-Z]+(\{[^}]*\})?/g,                  // \cmd or \cmd{arg}
    /"[^"]+"/g,                                  // "Book Title"
    /'[^']{2,}'/g,                               // 'Book Title' (>=2 to skip apostrophes in 'don't')
    /[“][^”]+[”]/g,               // “Book Title” (curly)
    /[‘][^’]+[’]/g,               // ‘Book Title’ (curly)
    /\*[^*\n]+\*/g,                              // *italic*
    /\b[A-Z]{2,}\b/g,                            // ACRONYMS
];

/**
 * Translate plain text EN → HI with protection. Empty / whitespace input
 * returns '' without making a network call.
 */
export async function translateToHindi(text) {
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
        const res = await translate(working, { to: 'hi' });
        translated = res?.text || '';
    } catch (e) {
        throw new Error(`google-translate failed: ${e.message}`);
    }

    // Restore. Google may garble the placeholder slightly (case, spaces around
    // underscores) — match loosely.
    translated = translated.replace(/__\s*KEEP\s*_\s*(\d+)\s*__/gi, (m, n) => {
        const idx = parseInt(n, 10);
        return (idx >= 0 && idx < placeholders.length) ? placeholders[idx] : m;
    });
    // Trim leftover protected-pattern artefacts (spaces we inserted around the placeholder)
    translated = translated.replace(/\s+/g, ' ').trim();
    return translated;
}

/**
 * Convenience: translate an array of strings sequentially.
 * Sequential (not parallel) because google-translate-api-x is throttled and
 * parallel calls trip its rate limiter.
 */
export async function translateMany(strings) {
    const out = [];
    for (const s of strings) {
        out.push(await translateToHindi(s));
    }
    return out;
}
