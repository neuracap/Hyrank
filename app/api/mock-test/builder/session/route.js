import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * GET /api/mock-test/builder/session
 * Load builder session data for a mock test + section:
 *   - Already accepted questions for the section (with text)
 *   - Available subtypes in the candidate pool for this section
 * Params: mock_test_id, section_id, exam_id
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

    if (!mock_test_id || !section_id || !exam_id) {
        return NextResponse.json({ error: 'mock_test_id, section_id, exam_id are required' }, { status: 400 });
    }

    try {
        // 1. Accepted questions for this section
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
                ps.session_label        AS source_session,
                ps.paper_date           AS source_date,
                mtq.position
            FROM mock_test_question mtq
            JOIN question_version qv ON qv.question_id = mtq.question_id AND qv.language = 'EN'
            JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            WHERE mtq.mock_test_id = $1
              AND mtq.exam_section_id = $2
            ORDER BY mtq.position ASC
        `, [mock_test_id, section_id]);

        // 2. Available subtypes in the pool for this section
        const subtypesRes = await db.query(`
            SELECT DISTINCT qv.subtype, COUNT(*) AS cnt
            FROM question_version qv
            WHERE qv.exam_section_id = $1
              AND qv.language = 'EN'
              AND qv.status = 'MANUALLY_CORRECTED'
              AND qv.subtype IS NOT NULL
            GROUP BY qv.subtype
            ORDER BY qv.subtype ASC
        `, [section_id]);

        return NextResponse.json({
            accepted: acceptedRes.rows,
            subtypes: subtypesRes.rows,
        });

    } catch (e) {
        console.error('mock-test/builder/session error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
