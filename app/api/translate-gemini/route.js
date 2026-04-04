import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-edge';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = 'gemini-3.1-flash-lite-preview';

/**
 * POST /api/translate-gemini
 * Translate exam question text + options from English to Hindi using Gemini.
 * Preserves LaTeX, English letter series, coded words, dictionary words.
 *
 * Body: { question_text, options: [{ opt_label, opt_text }] }
 * Returns: { question_text, options: [{ opt_label, opt_text }] }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.GEMINI_API_KEY) {
        return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    const { question_text, options } = await req.json();
    if (!question_text && (!options || options.length === 0)) {
        return NextResponse.json({ error: 'Nothing to translate' }, { status: 400 });
    }

    const optionsBlock = (options || [])
        .map(o => `${o.opt_label}) ${o.opt_text || ''}`)
        .join('\n');

    const prompt = `You are translating an Indian competitive exam question from English to Hindi.
We are creating the Hindi medium paper from the English one.

RULES:
1. Translate the question stem and options to natural Hindi (Devanagari script).
2. PRESERVE EXACTLY as-is (do NOT translate):
   - All LaTeX: anything inside $...$ or \\commands
   - \\includegraphics tags
   - English letter/number series patterns like: w_xxyywwx_yywwxxyyww_xyywwxx_y
   - English words used in coding-decoding questions like: 'FACTS', 'FOCUS', 'PENCIL'
   - Dictionary word rearrangement questions: keep the English words in English
   - Numbers, mathematical expressions, formulas
   - Option labels (A, B, C, D)
3. For reasoning questions with letter series or coded English words:
   - Translate ONLY the Hindi instruction part (e.g., "Select the option..." → "विकल्प चुनिए...")
   - Keep the English series/coded words/dictionary words exactly as they appear
4. Do NOT add any explanation. Return ONLY the translated content.
5. Do NOT use markdown fences.

Return a JSON object with this exact format:
{
  "question_text": "translated question stem in Hindi",
  "options": [
    { "opt_label": "A", "opt_text": "translated option A" },
    { "opt_label": "B", "opt_text": "translated option B" },
    { "opt_label": "C", "opt_text": "translated option C" },
    { "opt_label": "D", "opt_text": "translated option D" }
  ]
}

ENGLISH QUESTION:
${question_text || '(no text)'}

OPTIONS:
${optionsBlock || '(no options)'}`;

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const model = genAI.getGenerativeModel({ model: MODEL });
            const result = await model.generateContent({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    response_mime_type: 'application/json',
                    temperature: 0.1,
                },
            });

            const rawText = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            let parsed;
            try {
                parsed = JSON.parse(rawText);
            } catch {
                const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                parsed = JSON.parse(cleaned);
            }

            return NextResponse.json({
                success: true,
                question_text: parsed.question_text || question_text,
                options: parsed.options || options,
            });
        } catch (e) {
            console.error(`translate-gemini error (attempt ${attempt + 1}):`, e.message);
            if (attempt < MAX_RETRIES) {
                // Wait before retry (exponential backoff)
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                continue;
            }
            return NextResponse.json({ error: e.message }, { status: 500 });
        }
    }
}
