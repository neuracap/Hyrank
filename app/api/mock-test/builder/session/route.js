import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * GET /api/mock-test/builder/session
 * Load builder session data for a mock test + section.
 * Returns accepted questions (with options + solution + overrides) and available subtypes.
 * Params: mock_test_id, section_id, exam_id (exam_id used for subtype pool)
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const mock_test_id = searchParams.get('mock_test_id');
    const section_id   = searchParams.get('section_id');
    const exam_id      = searchParams.get('exam_id');

    if (!mock_test_id) {
        return NextResponse.json({ error: 'mock_test_id is required' }, { status: 400 });
    }

    try {
        // Accepted questions with full data + overrides
        // section_id='all' or '_' means load all sections for this mock test
        const sectionFilter = (section_id && section_id !== 'all' && section_id !== '_')
            ? 'AND mtq.exam_section_id = $2'
            : '';
        const params = sectionFilter ? [mock_test_id, section_id] : [mock_test_id];

        const acceptedRes = await db.query(`
            SELECT
                qv.question_id,
                qv.version_no,
                qv.subtype,
                qv.difficulty,
                qv.has_image,
                qv.correct_option_label,
                qv.body_json->>'text'   AS question_text,
                qv.source_question_no,
                qv.solution_json,
                ps.session_label        AS source_session,
                ps.paper_date           AS source_date,
                e.name                  AS source_exam,
                mtq.exam_section_id,
                mtq.position,
                mtq.slot_difficulty
            FROM mock_test_question mtq
            JOIN question_version qv ON qv.question_id = mtq.question_id AND qv.language = 'EN'
            JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            JOIN exam e ON e.exam_id = ps.exam_id
            WHERE mtq.mock_test_id = $1
              ${sectionFilter}
            ORDER BY mtq.position ASC
        `, params);

        // Fetch options for all accepted questions
        const questionIds = acceptedRes.rows.map(r => r.question_id);
        let optsByQuestion = {};
        if (questionIds.length > 0) {
            const optsRes = await db.query(`
                SELECT question_id, option_key, option_json->>'text' AS text, is_correct
                FROM question_option
                WHERE question_id = ANY($1) AND language = 'EN'
                ORDER BY option_key ASC
            `, [questionIds]);
            for (const o of optsRes.rows) {
                if (!optsByQuestion[o.question_id]) optsByQuestion[o.question_id] = [];
                optsByQuestion[o.question_id].push(o);
            }
        }

        const accepted = acceptedRes.rows.map(q => ({
            ...q,
            options: optsByQuestion[q.question_id] || [],
        }));

        // Available subtypes across all OTHER exams (for cross-exam filtering)
        const subtypeParams = exam_id ? [exam_id] : [];
        const subtypeFilter = exam_id ? `AND ps.exam_id != $1` : '';
        const subtypesRes = await db.query(`
            SELECT DISTINCT qv.subtype, COUNT(*) AS cnt
            FROM question_version qv
            JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            WHERE qv.language = 'EN'
              AND qv.status = 'MANUALLY_CORRECTED'
              AND (qv.solution_status = 'DONE' OR qv.has_image = true)
              AND qv.subtype IS NOT NULL
              ${subtypeFilter}
            GROUP BY qv.subtype
            ORDER BY cnt DESC
        `, subtypeParams);

        // Accepted subtype breakdown for this mock test
        let acceptedSubtypes = [];
        if (mock_test_id) {
            const accSubRes = await db.query(`
                SELECT qv.subtype, COUNT(*) AS cnt
                FROM mock_test_question mtq
                JOIN question_version qv ON qv.question_id = mtq.question_id AND qv.language = 'EN'
                WHERE mtq.mock_test_id = $1
                  AND qv.subtype IS NOT NULL
                GROUP BY qv.subtype
                ORDER BY cnt DESC
            `, [mock_test_id]);
            acceptedSubtypes = accSubRes.rows;
        }

        return NextResponse.json({
            accepted,
            subtypes: subtypesRes.rows,
            accepted_subtypes: acceptedSubtypes,
        });

    } catch (e) {
        console.error('mock-test/builder/session error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
