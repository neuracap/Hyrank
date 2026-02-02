import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `
You are a LaTeX/MathMarkdown syntax fixer. Fix ONLY LaTeX syntax errors in the given text.

CRITICAL RULES:
1. Output ONLY the corrected text - NO explanations, NO error listings, NO commentary whatsoever.
2. If you cannot fix it, return the original text exactly as-is.
3. Preserve all original Hindi/English wording exactly; fix ONLY LaTeX syntax.
4. Use inline math with \\(...\\) format.
5. Fix: mismatched braces, missing backslashes, wrong fractions, malformed degrees (use ^\\circ), theta tokens (use \\theta), trig powers (e.g., \\cos^2\\theta), \\left(\\right) pairs.
6. Remove OCR artifacts like (/circ), stray ), }.

Input: __INPUT_TEXT__

Output (corrected text only):`;

export async function POST(request) {
    try {
        const { text } = await request.json();

        if (!text) {
            return NextResponse.json({ error: 'Missing text' }, { status: 400 });
        }

        // SKIP if has image tags
        const hasImageTag = /\\includegraphics|!\[.*?\]\(|<img/i.test(text);
        if (hasImageTag) {
            return NextResponse.json({ fixedText: text });
        }

        // Only process if looks like it has math/latex
        const hasLatex = /[\\${}^_]/.test(text) || /(theta|pi|circ|alpha|beta|gamma)/i.test(text);

        if (!hasLatex) {
            return NextResponse.json({ fixedText: text });
        }

        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash-exp',
            generationConfig: {
                maxOutputTokens: 200,
            }
        });

        const prompt = SYSTEM_PROMPT.replace('__INPUT_TEXT__', text);
        const result = await model.generateContent(prompt);
        let corrected = result.response.text().trim();

        // Strip markdown code blocks if any
        if (corrected.startsWith('```')) {
            corrected = corrected.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
        }

        return NextResponse.json({ fixedText: corrected });

    } catch (e) {
        console.error('Fix LaTeX Error:', e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
