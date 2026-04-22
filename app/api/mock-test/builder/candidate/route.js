import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/mock-test/builder/candidate
 * Fetch the next candidate question for the builder.
 * Body: {
 *   mock_test_id,      — to exclude questions already accepted in this mock test
 *   section_id,        — exam_section to draw from
 *   exam_id,           — to exclude questions used in other mocks for this exam
 *   subtype?,          — optional subtype filter
 *   exclude_ids?,      — array of question_ids already seen/skipped this session
 * }
 * Returns: { question, pool_remaining } or { done: true }
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

    const { mock_test_id, section_id, exam_id, subtype, exclude_ids = [] } = body;
    if (!section_id || !exam_id) {
        return NextResponse.json({ error: 'section_id and exam_id are required' }, { status: 400 });
    }

    try {
        // Question IDs already accepted in any mock test for this exam
        const usedRes = await db.query(`
            SELECT DISTINCT mtq.question_id
            FROM mock_test_question mtq
            JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
            WHERE mt.exam_id = $1
        `, [exam_id]);
        const usedIds = usedRes.rows.map(r => r.question_id);

        // Also exclude from question_usage (previously published)
        const publishedRes = await db.query(`
            SELECT DISTINCT question_id FROM question_usage WHERE exam_id = $1
        `, [exam_id]);
        for (const r of publishedRes.rows) usedIds.push(r.question_id);

        // Combine all excluded IDs
        const allExcluded = [...new Set([...usedIds, ...exclude_ids])];

        const subtypeClause = subtype ? `AND qv.subtype = $3` : '';
        const params = subtype
            ? [section_id, allExcluded, subtype]
            : [section_id, allExcluded];

        // Fetch one random candidate
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
                ps.session_label        AS source_session,
                ps.paper_date           AS source_date,
                ps.paper_session_id     AS source_paper_id
            FROM question_version qv
            JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            WHERE qv.exam_section_id = $1
              AND qv.language = 'EN'
              AND qv.status = 'MANUALLY_CORRECTED'
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

        // Pool size (how many remain after this one)
        const countRes = await db.query(`
            SELECT COUNT(*) AS cnt
            FROM question_version qv
            WHERE qv.exam_section_id = $1
              AND qv.language = 'EN'
              AND qv.status = 'MANUALLY_CORRECTED'
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
