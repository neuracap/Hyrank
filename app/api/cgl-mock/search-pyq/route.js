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
    const subtype = (searchParams.get('subtype') || '').trim();         // exact bank subtype filter
    const excludeRaw = (searchParams.get('exclude_subtypes') || '').trim();
    const excludeSubtypes = excludeRaw ? excludeRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

    // Base conditions apply to both the listing AND the subtype-bucket aggregation.
    const baseConditions = [
        `qv.paper_session_id IS NOT NULL`,
        `qv.language = 'EN'`,
        `qv.question_type = 'MCQ'`,
        `qv.correct_option_label IS NOT NULL`,
    ];
    const baseParams = [];

    if (kind === 'visual_reasoning') {
        baseConditions.push(`qv.has_image = true`);
        baseConditions.push(`es.code IN ('REASONING','GIR','GI')`);
    } else {
        return NextResponse.json({ error: `Unknown kind: ${kind}` }, { status: 400 });
    }

    // Exclude anything used in any prior CGL T1 mock (any status).
    baseParams.push(CGL_T1_EXAM_ID);
    baseConditions.push(`NOT EXISTS (
        SELECT 1 FROM mock_test_question mtq
        JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
        WHERE mtq.question_id = qv.question_id AND mt.exam_id = $${baseParams.length}
    )`);

    const baseWhere = baseConditions.join(' AND ');

    // Listing conditions add text/subtype/exclude filters on top of the base.
    const conditions = [...baseConditions];
    const params = [...baseParams];

    if (q) {
        params.push(`%${q}%`);
        conditions.push(`(qv.body_json->>'text') ILIKE $${params.length}`);
    }
    if (subtype) {
        params.push(subtype);
        conditions.push(`qv.subtype = $${params.length}`);
    }
    if (excludeSubtypes.length > 0) {
        params.push(excludeSubtypes);
        conditions.push(`(qv.subtype IS NULL OR qv.subtype != ALL($${params.length}::text[]))`);
    }

    const where = conditions.join(' AND ');
    const client = await db.connect();
    try {
        // Subtype buckets (counts per subtype, ignoring text/subtype/exclude filters
        // so the UI can see ALL available subtypes — including the already-used ones,
        // which it can mark distinctly).
        const bucketRes = await client.query(`
            SELECT qv.subtype, COUNT(*)::int AS cnt
            FROM question_version qv
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE ${baseWhere}
            GROUP BY qv.subtype
            ORDER BY cnt DESC
        `, baseParams);
        const subtype_buckets = bucketRes.rows.map(r => ({
            subtype: r.subtype || 'unknown',
            count: r.cnt,
        }));

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

        return NextResponse.json({ success: true, total, rows: listRes.rows, subtype_buckets });
    } catch (e) {
        console.error('cgl-mock/search-pyq error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
