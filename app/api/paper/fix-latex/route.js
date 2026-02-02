import db from '@/lib/db';
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

async function fixWithGemini(text) {
    if (!text) return text;

    // SKIP questions with image tags - do not process these
    const hasImageTag = /\\includegraphics|!\[.*?\]\(|<img/i.test(text);
    if (hasImageTag) {
        console.log("Skipping question with image tag");
        return text; // Return original, don't process
    }

    // Heuristic: Only process if text looks like it has math/latex or OCR artifacts
    const hasLatex = /[\\${}^_]/.test(text) || /(theta|pi|circ|alpha|beta|gamma)/i.test(text);

    if (!hasLatex) return text;

    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash-lite',
            generationConfig: {
                maxOutputTokens: 100, // Limit response to under 100 tokens
            }
        });
        const prompt = SYSTEM_PROMPT.replace('__INPUT_TEXT__', text);

        const result = await model.generateContent(prompt);
        let corrected = result.response.text().trim();

        // Strip markdown code blocks if any
        if (corrected.startsWith('```')) {
            corrected = corrected.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
        }

        return corrected;
    } catch (e) {
        console.error("Gemini Error processing text:", text.substring(0, 50), e.message);
        return text; // Fallback to original
    }
}

export async function POST(request) {
    const { paper_session_id } = await request.json();

    if (!paper_session_id) {
        return NextResponse.json({ error: 'Missing paper_session_id' }, { status: 400 });
    }

    const client = await db.connect();
    let stats = { questionsChecked: 0, questionsFixed: 0, optionsChecked: 0, optionsFixed: 0 };

    try {
        // No transaction block used here because LLM process is long-running 
        // and we want to commit progress incrementally or at least not hold lock for minutes.
        // Actually, for consistency, we can update one by one.

        // 1. Fetch Questions
        const qRes = await client.query(`
            SELECT question_id, source_question_no, body_json 
            FROM question_version 
            WHERE paper_session_id = $1
            ORDER BY question_number_int ASC
        `, [paper_session_id]);

        stats.questionsChecked = qRes.rows.length;
        console.log(`Processing ${qRes.rows.length} questions with LLM...`);

        for (const q of qRes.rows) {
            let text = q.body_json?.text || '';
            const newText = await fixWithGemini(text);

            if (newText && newText !== text) {
                await client.query(`
                    UPDATE question_version 
                    SET body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text))
                    WHERE question_id = $2
                `, [newText, q.question_id]);
                console.log(`Fixed Q.${q.source_question_no}`);
                stats.questionsFixed++;
            }
        }

        // 2. Fetch Options
        const optRes = await client.query(`
            SELECT qo.question_id, qo.language, qo.option_key, qo.option_json 
            FROM question_option qo
            JOIN question_version qv ON qo.question_id = qv.question_id
            WHERE qv.paper_session_id = $1
        `, [paper_session_id]);

        stats.optionsChecked = optRes.rows.length;
        console.log(`Processing ${optRes.rows.length} options with LLM...`);

        for (const opt of optRes.rows) {
            let text = opt.option_json?.text || '';
            const newText = await fixWithGemini(text);

            if (newText && newText !== text) {
                await client.query(`
                    UPDATE question_option 
                    SET option_json = jsonb_set(option_json, '{text}', to_jsonb($1::text))
                    WHERE question_id = $2 AND language = $3 AND option_key = $4
                `, [newText, opt.question_id, opt.language, opt.option_key]);
                stats.optionsFixed++;
            }
        }

        return NextResponse.json({ success: true, stats });

    } catch (e) {
        console.error('Fix LaTeX Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
