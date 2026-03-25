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
    const language = (searchParams.get('language') || 'EN').toUpperCase();
    if (!paperId) {
        return NextResponse.json({ error: 'paperId is required' }, { status: 400 });
    }

    let client;
    try {
        client = await db.connect();

        const questionsRes = await client.query(`
            SELECT
                qv.question_id,
                qv.version_no,
                qv.source_question_no AS source_q_no,
                qv.body_json->>'text' AS question_text,
                qv.difficulty,
                qv.subtype,
                qv.correct_option_label,
                qv.final_answer_text,
                qv.solution_status,
                qv.solution_figure_helpful,
                qv.solution_figure_prompt,
                qv.solution_json,
                qv.solution_json->>'answer_label' AS answer_label,
                qv.solution_json->>'solution_text' AS solution_text,
                qv.solution_json->>'tags' AS tags,
                es.code AS section_code
            FROM question_version qv
            LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE qv.paper_session_id = $1
              AND qv.language = $2
            ORDER BY qv.question_number_int ASC NULLS LAST
        `, [paperId, language]);

        // Parse solution_json strings
        for (const q of questionsRes.rows) {
            if (typeof q.solution_json === 'string') {
                try { q.solution_json = JSON.parse(q.solution_json); } catch { q.solution_json = null; }
            }
        }

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
              AND language = $2
            ORDER BY option_key ASC
        `, [questionIds, language]);

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
