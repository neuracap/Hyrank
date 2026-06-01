import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { CGL_T1_EXAM_ID } from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cgl-mock/search-pyq
 *   ?kind=visual_reasoning   (only mode supported today)
 *   ?q=<text search>         (substring on body_json text)
 *   ?limit=20  ?offset=0
 *
 * Returns verified PYQ questions matching the kind, with their stems +
 * options, excluding anything already used in any CGL T1 mock so the
 * picker never lands on a duplicate.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const kind = searchParams.get('kind') || 'visual_reasoning';
    const q = (searchParams.get('q') || '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

    const conditions = [
        `qv.paper_session_id IS NOT NULL`,
        `qv.language = 'EN'`,
        `qv.question_type = 'MCQ'`,
        `qv.correct_option_label IS NOT NULL`,
    ];
    const params = [];

    if (kind === 'visual_reasoning') {
        conditions.push(`qv.has_image = true`);
        conditions.push(`es.code IN ('REASONING','GIR','GI')`);
    } else {
        return NextResponse.json({ error: `Unknown kind: ${kind}` }, { status: 400 });
    }

    if (q) {
        params.push(`%${q}%`);
        conditions.push(`(qv.body_json->>'text') ILIKE $${params.length}`);
    }

    // Exclude any question used in any CGL T1 mock (any status).
    params.push(CGL_T1_EXAM_ID);
    conditions.push(`NOT EXISTS (
        SELECT 1 FROM mock_test_question mtq
        JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
        WHERE mtq.question_id = qv.question_id AND mt.exam_id = $${params.length}
    )`);

    const where = conditions.join(' AND ');
    const client = await db.connect();
    try {
        const countRes = await client.query(`
            SELECT COUNT(*)::int AS c
            FROM question_version qv
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE ${where}
        `, params);
        const total = countRes.rows[0].c;

        params.push(limit, offset);
        const listRes = await client.query(`
            SELECT qv.question_id, qv.version_no, qv.difficulty, qv.subtype,
                   qv.correct_option_label, qv.body_json, qv.has_image,
                   qv.paper_session_id, es.code AS section_code,
                   ps.session_label, ps.paper_date,
                   e.code AS exam_code,
                   (
                       SELECT jsonb_object_agg(qo.option_key, qo.option_json ORDER BY qo.option_key)
                       FROM question_option qo
                       WHERE qo.question_id = qv.question_id
                         AND qo.version_no  = qv.version_no
                         AND qo.language    = 'EN'
                   ) AS options
            FROM question_version qv
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            LEFT JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            LEFT JOIN exam e ON e.exam_id = ps.exam_id
            WHERE ${where}
            ORDER BY ps.paper_date DESC NULLS LAST, qv.question_id
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        return NextResponse.json({ success: true, total, rows: listRes.rows });
    } catch (e) {
        console.error('cgl-mock/search-pyq error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
