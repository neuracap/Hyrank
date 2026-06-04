import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/current-affairs/list
 *
 * Query params (all optional):
 *   status:   NEW | APPROVED | REJECTED
 *   year:     int
 *   quarter:  1..4
 *   subtype:  ca_economy | ca_polity_schemes | ...
 *   search:   substring match on headline + mcq stem
 *   limit:    int (default 50, max 200)
 *   offset:   int (default 0)
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const year = searchParams.get('year');
    const quarter = searchParams.get('quarter');
    const subtype = searchParams.get('subtype');
    const search = (searchParams.get('search') || '').trim();
    const limit = Math.max(1, Math.min(200, parseInt(searchParams.get('limit') || '50', 10) || 50));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);

    const conditions = ['1=1'];
    const params = [];
    if (status) {
        params.push(status);
        conditions.push(`status = $${params.length}`);
    }
    if (year) {
        params.push(parseInt(year, 10));
        conditions.push(`relevance_year = $${params.length}`);
    }
    if (quarter) {
        params.push(parseInt(quarter, 10));
        conditions.push(`relevance_quarter = $${params.length}`);
    }
    if (subtype) {
        params.push(subtype);
        conditions.push(`ca_subtype = $${params.length}`);
    }
    if (search) {
        params.push(`%${search}%`);
        conditions.push(`(headline ILIKE $${params.length} OR (mcq_json->>'stem') ILIKE $${params.length})`);
    }
    const where = conditions.join(' AND ');

    const client = await db.connect();
    try {
        const totalRes = await client.query(`SELECT COUNT(*)::int AS c FROM current_affairs WHERE ${where}`, params);
        params.push(limit, offset);
        const listRes = await client.query(`
            SELECT id, headline, summary, source, source_url, published_at, category,
                   ca_subtype, relevance_year, relevance_quarter, difficulty,
                   mcq_json, status, rejection_reason, materialized_question_id,
                   materialized_at, created_at
            FROM current_affairs
            WHERE ${where}
            ORDER BY created_at DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        // Counts by status (for the UI's quick filter tabs)
        const countsRes = await client.query(`
            SELECT status, COUNT(*)::int AS c
            FROM current_affairs
            GROUP BY status
        `);
        const counts_by_status = {};
        for (const row of countsRes.rows) counts_by_status[row.status || 'UNKNOWN'] = row.c;

        return NextResponse.json({
            success: true,
            total: totalRes.rows[0].c,
            rows: listRes.rows,
            counts_by_status,
        });
    } catch (e) {
        console.error('current-affairs/list error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
