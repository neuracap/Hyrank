import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/mock-test/builder/candidate
 * Fetch the next candidate question from OTHER exams (cross-exam sourcing).
 * Subtype is the primary quality filter — candidates come from any exam
 * except the one being built.
 *
 * Body: {
 *   mock_test_id,   — to exclude questions already accepted in THIS mock test
 *   target_exam_id, — the exam we're building for (excluded from candidates)
 *   subtype?,       — primary filter; if omitted, draws from all subtypes
 *   exclude_ids?,   — question_ids already seen/skipped this session
 * }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { mock_test_id, target_exam_id, subtype, exclude_ids = [] } = body;
    if (!target_exam_id) {
        return NextResponse.json({ error: 'target_exam_id is required' }, { status: 400 });
    }

    try {
        // IDs already accepted in this mock test
        const acceptedRes = await db.query(`
            SELECT question_id FROM mock_test_question WHERE mock_test_id = $1
        `, [mock_test_id || '00000000-0000-0000-0000-000000000000']);
        const acceptedIds = acceptedRes.rows.map(r => r.question_id);

        const allExcluded = [...new Set([...acceptedIds, ...exclude_ids])];

        const subtypeClause = subtype ? `AND qv.subtype = $3` : '';
        const params = subtype
            ? [target_exam_id, allExcluded, subtype]
            : [target_exam_id, allExcluded];

        const res = await db.query(`
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
                e.code                  AS source_exam_code
            FROM question_version qv
            JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            JOIN exam e ON e.exam_id = ps.exam_id
            WHERE ps.exam_id != $1
              AND qv.language = 'EN'
              AND qv.status = 'MANUALLY_CORRECTED'
              AND (qv.solution_status = 'DONE' OR qv.has_image = true)
              AND ($2::uuid[] IS NULL OR qv.question_id != ALL($2::uuid[]))
              ${subtypeClause}
            ORDER BY RANDOM()
            LIMIT 1
        `, params);

        if (res.rows.length === 0) {
            return NextResponse.json({ done: true, pool_remaining: 0 });
        }

        const q = res.rows[0];

        // Fetch options
        const opts = await db.query(`
            SELECT option_key, option_json->>'text' AS text, is_correct
            FROM question_option
            WHERE question_id = $1 AND language = 'EN'
            ORDER BY option_key ASC
        `, [q.question_id]);
        q.options = opts.rows;

        // Pool count
        const countRes = await db.query(`
            SELECT COUNT(*) AS cnt
            FROM question_version qv
            JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            WHERE ps.exam_id != $1
              AND qv.language = 'EN'
              AND qv.status = 'MANUALLY_CORRECTED'
              AND (qv.solution_status = 'DONE' OR qv.has_image = true)
              AND ($2::uuid[] IS NULL OR qv.question_id != ALL($2::uuid[]))
              ${subtypeClause}
        `, params);
        const poolRemaining = Math.max(0, parseInt(countRes.rows[0].cnt) - 1);

        return NextResponse.json({ question: q, pool_remaining: poolRemaining });

    } catch (e) {
        console.error('mock-test/builder/candidate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
