import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/issues/list?status=open&issue_type=...&q=...&limit=50&offset=0
 *
 * Lists student-submitted question issue reports. Joins lightly to
 * question_version (EN) for a stem preview and subtype, so the admin
 * can triage without opening every row.
 *
 * Filters:
 *   status      — 'open' | 'resolved' | 'dismissed' | 'all' (default 'open')
 *   issue_type  — exact match on the type slug, or 'all'
 *   q           — substring search over description / resolution_notes
 *                 / question stem
 *   limit       — 1..200 (default 50)
 *   offset      — pagination offset (default 0)
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get('status') || 'open').toLowerCase();
    const issueType = searchParams.get('issue_type');
    const q = (searchParams.get('q') || '').trim();
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const where = [];
    const params = [];
    if (status && status !== 'all') {
        params.push(status);
        where.push(`r.status = $${params.length}`);
    }
    if (issueType && issueType !== 'all') {
        params.push(issueType);
        where.push(`r.issue_type = $${params.length}`);
    }
    if (q) {
        params.push(`%${q}%`);
        const i = params.length;
        where.push(`(
            r.description ILIKE $${i}
            OR r.resolution_notes ILIKE $${i}
            OR qv.body_json->>'text' ILIKE $${i}
        )`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    try {
        const listSql = `
            SELECT
                r.id, r.user_id, r.question_id, r.version_no, r.language,
                r.issue_type, r.description, r.context,
                r.session_id, r.attempt_id, r.exam_code,
                r.status, r.created_at, r.resolved_at, r.resolution_notes,
                qv.subtype, qv.difficulty, qv.correct_option_label,
                LEFT(COALESCE(qv.body_json->>'text', ''), 280) AS question_preview
            FROM question_issue_reports r
            LEFT JOIN LATERAL (
                SELECT subtype, difficulty, correct_option_label, body_json
                FROM question_version
                WHERE question_id = r.question_id AND language = 'EN'
                ORDER BY version_no DESC
                LIMIT 1
            ) qv ON TRUE
            ${whereSql}
            ORDER BY r.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `;
        const countSql = `
            SELECT COUNT(*)::int AS n
            FROM question_issue_reports r
            LEFT JOIN LATERAL (
                SELECT body_json
                FROM question_version
                WHERE question_id = r.question_id AND language = 'EN'
                ORDER BY version_no DESC
                LIMIT 1
            ) qv ON TRUE
            ${whereSql}
        `;
        const facetSql = `
            SELECT
                status,
                issue_type,
                COUNT(*)::int AS n
            FROM question_issue_reports
            GROUP BY status, issue_type
        `;

        const [listRes, countRes, facetRes] = await Promise.all([
            db.query(listSql, params),
            db.query(countSql, params),
            db.query(facetSql),
        ]);

        // Build status + issue-type counts independent of current filters
        // so the admin can see what else is waiting.
        const statusCounts = { open: 0, resolved: 0, dismissed: 0 };
        const typeCounts = {};
        for (const row of facetRes.rows) {
            statusCounts[row.status] = (statusCounts[row.status] || 0) + row.n;
            typeCounts[row.issue_type] = (typeCounts[row.issue_type] || 0) + row.n;
        }

        return NextResponse.json({
            success: true,
            rows: listRes.rows,
            total: countRes.rows[0]?.n || 0,
            counts: { status: statusCounts, issue_type: typeCounts },
            limit,
            offset,
        });
    } catch (e) {
        console.error('issues/list error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
