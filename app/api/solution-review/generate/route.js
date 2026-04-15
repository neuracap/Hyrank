import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { canAccessSolutionReview } from '@/lib/permissions';

export async function POST(request) {
    const user = await getCurrentUser();
    if (!canAccessSolutionReview(user)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { paper_session_id } = body;
    if (!paper_session_id) {
        return NextResponse.json({ error: 'paper_session_id is required' }, { status: 400 });
    }

    let client;
    try {
        client = await db.connect();

        // Fetch all EN questions for this paper
        const questionsRes = await client.query(`
            SELECT
                question_id,
                version_no,
                source_question_no AS source_q_no,
                body_json->>'text' AS question_text,
                difficulty,
                solution_json->>'answer_label' AS answer_label,
                solution_json->>'solution_text' AS solution_text,
                solution_json->>'tags' AS tags
            FROM question_version
            WHERE paper_session_id = $1
              AND language = 'EN'
            ORDER BY source_question_no ASC NULLS LAST
        `, [paper_session_id]);

        const questions = questionsRes.rows;

        if (questions.length === 0) {
            return NextResponse.json({ solutions: [] });
        }

        const questionIds = questions.map(q => q.question_id);

        const optionsRes = await client.query(`
            SELECT
                question_id,
                option_key AS opt_label,
                option_json->>'text' AS opt_text
            FROM question_option
            WHERE question_id = ANY($1)
              AND language = 'EN'
            ORDER BY option_key ASC
        `, [questionIds]);

        client.release();
        client = null;

        // Group options by question_id
        const optionsByQuestion = {};
        for (const opt of optionsRes.rows) {
            if (!optionsByQuestion[opt.question_id]) {
                optionsByQuestion[opt.question_id] = [];
            }
            optionsByQuestion[opt.question_id].push(opt);
        }

        const questionsWithOptions = questions.map(q => ({
            ...q,
            options: optionsByQuestion[q.question_id] || [],
        }));

        // Import Anthropic
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const parseResponse = (text) => {
            const answerMatch = text.match(/^ANSWER:\s*([A-D])/im);
            const difficultyMatch = text.match(/^DIFFICULTY:\s*(easy|medium|hard)/im);
            const tagsMatch = text.match(/^TAGS:\s*(.+)/im);
            const solutionMatch = text.match(/^SOLUTION:\s*([\s\S]*)/im);

            return {
                answer_label: answerMatch ? answerMatch[1].toUpperCase() : null,
                difficulty: difficultyMatch ? difficultyMatch[1].toLowerCase() : null,
                tags: tagsMatch ? tagsMatch[1].trim() : null,
                solution_text: solutionMatch ? solutionMatch[1].trim() : null,
            };
        };

        const solveQuestion = async (q) => {
            const opts = q.options;
            const getOpt = (label) => opts.find(o => o.opt_label === label)?.opt_text || '';

            const prompt = `Solve this MCQ from an Indian competitive exam.

Question: ${q.question_text || '(no text)'}
A) ${getOpt('A')}
B) ${getOpt('B')}
C) ${getOpt('C')}
D) ${getOpt('D')}

Reply in EXACTLY this format, nothing else:
ANSWER: [A/B/C/D]
DIFFICULTY: [easy/medium/hard]
TAGS: [2-3 comma-separated topic tags]
SOLUTION: [concise step-by-step solution with any shortcuts or tricks]`;

            try {
                const response = await anthropic.messages.create({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 600,
                    messages: [{ role: 'user', content: prompt }],
                });

                const text = response.content?.[0]?.text || '';
                const parsed = parseResponse(text);
                return { question_id: q.question_id, ...parsed };
            } catch (err) {
                console.error(`Error solving question ${q.question_id}:`, err.message);
                return { question_id: q.question_id, answer_label: null, difficulty: null, tags: null, solution_text: null };
            }
        };

        // Process in batches of 10
        const BATCH_SIZE = 10;
        const results = [];

        for (let i = 0; i < questionsWithOptions.length; i += BATCH_SIZE) {
            const batch = questionsWithOptions.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.allSettled(batch.map(solveQuestion));
            for (const r of batchResults) {
                if (r.status === 'fulfilled' && r.value) {
                    results.push(r.value);
                }
            }
        }

        return NextResponse.json({ solutions: results });

    } catch (error) {
        console.error('solution-review/generate error:', error);
        return NextResponse.json({ error: 'AI generation failed', details: error.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
