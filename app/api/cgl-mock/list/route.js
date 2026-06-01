import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { CGL_T1_EXAM_ID } from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cgl-mock/list?status=DRAFT|PUBLISHED|ALL
 * Lists CGL T1 mock tests. Default: DRAFT.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get('status') || 'DRAFT';

    const params = [CGL_T1_EXAM_ID];
    let where = `WHERE mt.exam_id = $1 AND mt.stats_json->>'builder' = 'cgl-mock-builder'`;
    if (statusFilter !== 'ALL') {
        params.push(statusFilter);
        where += ` AND mt.status = $${params.length}`;
    }

    const client = await db.connect();
    try {
        const rows = await client.query(`
            SELECT
                mt.mock_test_id, mt.name, mt.slug, mt.status, mt.type,
                mt.created_at, mt.updated_at, mt.published_at,
                (SELECT COUNT(*)::int FROM mock_test_question mtq WHERE mtq.mock_test_id = mt.mock_test_id) AS question_count,
                (mt.stats_json->'config')   AS config,
                (mt.stats_json->'section_stats') AS section_stats,
                (mt.stats_json->'notes')    AS notes
            FROM mock_test mt
            ${where}
            ORDER BY mt.created_at DESC
        `, params);
        return NextResponse.json({ success: true, rows: rows.rows });
    } catch (e) {
        console.error('cgl-mock/list error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
