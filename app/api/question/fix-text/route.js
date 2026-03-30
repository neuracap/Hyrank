import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-edge';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = 'gemini-2.5-flash-lite';

/**
 * POST /api/question/fix-text
 * Send question text to Gemini to fix spelling, missing characters, and incomplete words.
 * Body: { text, language }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!GEMINI_API_KEY) {
        return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    const { text, language } = await req.json();
    if (!text || !text.trim()) {
        return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const lang = (language || 'HI').toUpperCase();
    const langName = lang === 'HI' ? 'Hindi' : 'English';

    const prompt = `You are a proofreader for ${langName} competitive exam questions (SSC, Banking, UPSC).

The following question text was extracted from a PDF using OCR and may have:
- Missing characters or incomplete words (especially in ${langName} / Devanagari script)
- Spelling errors
- Garbled or corrupted characters
- Missing matras/vowel signs in Hindi (e.g., "क" instead of "का", "ह" instead of "है")

Your task:
1. Fix all spelling errors and missing characters
2. Complete any incomplete or garbled words
3. Preserve ALL LaTeX formatting exactly as-is (anything inside $...$ or \\commands)
4. Preserve ALL \\includegraphics tags exactly as-is
5. Do NOT change the meaning, add new content, or rephrase
6. Do NOT add any explanation — return ONLY the corrected text

Input text:
${text}

Corrected text:`;

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: MODEL_NAME });
        const result = await model.generateContent({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2000 },
        });

        const corrected = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        // Strip any markdown fences the model might add
        const cleaned = corrected.replace(/^```[\s\S]*?\n/, '').replace(/\n```\s*$/, '').trim();

        return NextResponse.json({ success: true, corrected: cleaned });
    } catch (e) {
        console.error('question/fix-text error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
