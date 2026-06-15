import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { canAccessSolutionReview } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/solution-review/bilingual-unlinked?en_session_id=...&hi_session_id=...
 *
 * Returns the standalone (unlinked) EN and HI questions that belong to the
 * two given paper sessions but have no row in question_links pairing them
 * to a counterpart in the other paper. Shape matches one side of a
 * bilingual pair so the same review card can render it with the other
 * side empty.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!canAccessSolutionReview(user)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const enSessionId = searchParams.get('en_session_id');
    const hiSessionId = searchParams.get('hi_session_id');
    if (!enSessionId || !hiSessionId) {
        return NextResponse.json({ error: 'en_session_id and hi_session_id are required' }, { status: 400 });
    }

    try {
        const enRes = await db.query(`
            SELECT
                qv.question_id, qv.version_no,
                qv.body_json->>'text' AS text,
                qv.source_question_no AS q_no,
                qv.question_number_int AS q_int,
                qv.subtype, qv.difficulty, qv.correct_option_label AS correct,
                qv.final_answer_text AS answer_text,
                qv.solution_status, qv.solution_json,
                qv.solution_figure_helpful AS figure_helpful,
                qv.solution_figure_prompt AS figure_prompt,
                qv.mock_worthiness,
                es.code AS section_code
            FROM question_version qv
            LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE qv.paper_session_id = $1
              AND qv.language = 'EN'
              AND NOT EXISTS (
                  SELECT 1 FROM question_links ql
                  WHERE ql.english_question_id = qv.question_id
                    AND ql.english_version_no = qv.version_no
                    AND ql.paper_session_id_english = $1
                    AND ql.paper_session_id_hindi = $2
              )
            ORDER BY es.sort_order ASC NULLS LAST, qv.question_number_int ASC NULLS LAST
        `, [enSessionId, hiSessionId]);

        const hiRes = await db.query(`
            SELECT
                qv.question_id, qv.version_no,
                qv.body_json->>'text' AS text,
                qv.source_question_no AS q_no,
                qv.question_number_int AS q_int,
                qv.subtype, qv.difficulty, qv.correct_option_label AS correct,
                qv.final_answer_text AS answer_text,
                qv.solution_status, qv.solution_json,
                qv.solution_figure_helpful AS figure_helpful,
                qv.solution_figure_prompt AS figure_prompt,
                qv.mock_worthiness,
                es.code AS section_code
            FROM question_version qv
            LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE qv.paper_session_id = $1
              AND qv.language = 'HI'
              AND NOT EXISTS (
                  SELECT 1 FROM question_links ql
                  WHERE ql.hindi_question_id = qv.question_id
                    AND ql.hindi_version_no = qv.version_no
                    AND ql.paper_session_id_hindi = $1
                    AND ql.paper_session_id_english = $2
              )
            ORDER BY es.sort_order ASC NULLS LAST, qv.question_number_int ASC NULLS LAST
        `, [hiSessionId, enSessionId]);

        const allQids = [
            ...enRes.rows.map(r => r.question_id),
            ...hiRes.rows.map(r => r.question_id),
        ];
        const optionsMap = {};
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

        const enrich = (r, lang) => ({
            question_id: r.question_id,
            version_no: r.version_no,
            text: r.text,
            q_no: r.q_no,
            q_int: r.q_int,
            subtype: r.subtype,
            difficulty: r.difficulty,
            correct: r.correct,
            answer_text: r.answer_text,
            solution_status: r.solution_status,
            solution_json: r.solution_json || {},
            figure_helpful: r.figure_helpful,
            figure_prompt: r.figure_prompt,
            mock_worthiness: r.mock_worthiness,
            options: optionsMap[`${r.question_id}|${lang}`] || [],
            section_code: r.section_code,
        });

        return NextResponse.json({
            success: true,
            en_unlinked: enRes.rows.map(r => enrich(r, 'EN')),
            hi_unlinked: hiRes.rows.map(r => enrich(r, 'HI')),
        });
    } catch (e) {
        console.error('solution-review/bilingual-unlinked error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
