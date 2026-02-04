import { NextResponse } from 'next/server';
import { translate } from 'google-translate-api-x';

export async function POST(request) {
    try {
        const { text, source, target } = await request.json();

        if (!text || !text.trim()) {
            return NextResponse.json({ translatedText: '' });
        }

        // Protect LaTeX and other patterns
        const placeholders = [];
        const replacer = (match) => {
            placeholders.push(match);
            return `__LATEX_${placeholders.length - 1}__`;
        };

        // Regex patterns to protect
        const patterns = [
            /\\includegraphics\{[^}]+\}/g,     // images
            /\$[^$]+\$/g,                      // $ math $
            /\\\([^\)]+\\\)/g,                 // \( math \)
            /\\\[[^\]]+\\\]/g,                 // \[ math \]
            /\\[a-zA-Z]+(\{[^}]*\})?/g         // \command or \command{arg}
        ];

        let protectedText = text;
        patterns.forEach(pattern => {
            protectedText = protectedText.replace(pattern, replacer);
        });

        // Translate
        const res = await translate(protectedText, { from: source === 'auto' ? undefined : source, to: target });
        let translatedText = res.text;

        // Restore placeholders
        // We use a regex to find __LATEX_N__ even if spaces inserted
        translatedText = translatedText.replace(/__LATEX_(\d+)__/gi, (match, p1) => {
            const idx = parseInt(p1);
            if (idx >= 0 && idx < placeholders.length) {
                return placeholders[idx];
            }
            return match;
        });

        return NextResponse.json({ translatedText: translatedText });

    } catch (e) {
        console.error("Translation error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
