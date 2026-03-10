import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export async function GET(request) {
    const user = await getCurrentUser();
    if (!user || !user.isAdmin) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const paperId = searchParams.get('paperId');
    if (!paperId) {
        return NextResponse.json({ error: 'paperId is required' }, { status: 400 });
    }

    let client;
    try {
        client = await db.connect();

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
        `, [paperId]);

        const questions = questionsRes.rows;

        if (questions.length === 0) {
            return NextResponse.json({ questions: [] });
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

        // Group options by question_id
        const optionsByQuestion = {};
        for (const opt of optionsRes.rows) {
            if (!optionsByQuestion[opt.question_id]) {
                optionsByQuestion[opt.question_id] = [];
            }
            optionsByQuestion[opt.question_id].push(opt);
        }

        // Attach options to each question
        const questionsWithOptions = questions.map(q => ({
            ...q,
            options: optionsByQuestion[q.question_id] || [],
        }));

        return NextResponse.json({ questions: questionsWithOptions });

    } catch (error) {
        console.error('solution-review/questions error:', error);
        return NextResponse.json({ error: 'Failed to load questions', details: error.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
