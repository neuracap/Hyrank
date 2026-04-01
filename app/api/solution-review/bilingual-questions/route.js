import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/solution-review/bilingual-questions?en_session_id=xxx&hi_session_id=yyy
 * Returns linked EN+HI question pairs with solutions side by side.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const enSessionId = searchParams.get('en_session_id');
    const hiSessionId = searchParams.get('hi_session_id');

    if (!enSessionId || !hiSessionId) {
        return NextResponse.json({ error: 'en_session_id and hi_session_id are required' }, { status: 400 });
    }

    try {
        // 1. Fetch linked pairs with both EN and HI question data
        const pairsRes = await db.query(`
            SELECT
                ql.id AS link_id,
                ql.status AS link_status,

                -- English
                qe.question_id AS en_question_id,
                qe.version_no AS en_version_no,
                qe.body_json->>'text' AS en_text,
                qe.source_question_no AS en_q_no,
                qe.question_number_int AS en_q_int,
                qe.subtype AS en_subtype,
                qe.difficulty AS en_difficulty,
                qe.correct_option_label AS en_correct,
                qe.final_answer_text AS en_answer_text,
                qe.solution_status AS en_solution_status,
                qe.solution_json AS en_solution_json,
                qe.solution_figure_helpful AS en_figure_helpful,
                qe.solution_figure_prompt AS en_figure_prompt,
                qe.mock_worthiness AS en_mock_worthiness,

                -- Hindi
                qh.question_id AS hi_question_id,
                qh.version_no AS hi_version_no,
                qh.body_json->>'text' AS hi_text,
                qh.source_question_no AS hi_q_no,
                qh.question_number_int AS hi_q_int,
                qh.subtype AS hi_subtype,
                qh.difficulty AS hi_difficulty,
                qh.correct_option_label AS hi_correct,
                qh.final_answer_text AS hi_answer_text,
                qh.solution_status AS hi_solution_status,
                qh.solution_json AS hi_solution_json,
                qh.solution_figure_helpful AS hi_figure_helpful,
                qh.solution_figure_prompt AS hi_figure_prompt,

                es.code AS section_code

            FROM question_links ql
            INNER JOIN question_version qe
                ON ql.english_question_id = qe.question_id
                AND ql.english_version_no = qe.version_no
                AND qe.language = 'EN'
            LEFT JOIN question_version qh
                ON ql.hindi_question_id = qh.question_id
                AND ql.hindi_version_no = qh.version_no
                AND qh.language = 'HI'
            LEFT JOIN exam_section es ON es.section_id = qe.exam_section_id
            WHERE ql.paper_session_id_english = $1
              AND ql.paper_session_id_hindi = $2
            ORDER BY es.sort_order ASC NULLS LAST, qe.question_number_int ASC NULLS LAST
        `, [enSessionId, hiSessionId]);

        const pairs = pairsRes.rows;

        // 2. Collect all question_ids for options fetch
        const allQids = [];
        for (const p of pairs) {
            if (p.en_question_id) allQids.push(p.en_question_id);
            if (p.hi_question_id) allQids.push(p.hi_question_id);
        }

        // 3. Fetch options for all questions
        let optionsMap = {};
        if (allQids.length > 0) {
            const optRes = await db.query(`
                SELECT question_id, language, option_key,
                       option_json->>'text' AS opt_text, is_correct
                FROM question_option
                WHERE question_id = ANY($1)
                ORDER BY option_key ASC
            `, [allQids]);

            for (const o of optRes.rows) {
                const key = `${o.question_id}|${o.language}`;
                if (!optionsMap[key]) optionsMap[key] = [];
                optionsMap[key].push(o);
            }
        }

        // 4. Assemble pairs with options
        const questions = pairs.map(p => {
            // Parse solution_json display_sections
            const enSolution = p.en_solution_json || {};
            const hiSolution = p.hi_solution_json || {};

            return {
                link_id: p.link_id,
                link_status: p.link_status,
                section_code: p.section_code,
                en: {
                    question_id: p.en_question_id,
                    version_no: p.en_version_no,
                    text: p.en_text,
                    q_no: p.en_q_no,
                    q_int: p.en_q_int,
                    subtype: p.en_subtype,
                    difficulty: p.en_difficulty,
                    correct: p.en_correct,
                    answer_text: p.en_answer_text,
                    solution_status: p.en_solution_status,
                    solution_json: enSolution,
                    figure_helpful: p.en_figure_helpful,
                    figure_prompt: p.en_figure_prompt,
                    mock_worthiness: p.en_mock_worthiness,
                    options: optionsMap[`${p.en_question_id}|EN`] || [],
                },
                hi: p.hi_question_id ? {
                    question_id: p.hi_question_id,
                    version_no: p.hi_version_no,
                    text: p.hi_text,
                    q_no: p.hi_q_no,
                    q_int: p.hi_q_int,
                    subtype: p.hi_subtype,
                    difficulty: p.hi_difficulty,
                    correct: p.hi_correct,
                    answer_text: p.hi_answer_text,
                    solution_status: p.hi_solution_status,
                    solution_json: hiSolution,
                    figure_helpful: p.hi_figure_helpful,
                    figure_prompt: p.hi_figure_prompt,
                    options: optionsMap[`${p.hi_question_id}|HI`] || [],
                } : null,
            };
        });

        return NextResponse.json({
            success: true,
            total: questions.length,
            questions,
        });
    } catch (e) {
        console.error('solution-review/bilingual-questions error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
