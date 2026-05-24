import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/admin/maintenance/promote-fully-corrected
 * Finds papers currently in NOT_REVIEWED where every question_version row has
 * status = 'MANUALLY_CORRECTED', and advances them to TEAM_REVIEWED.
 * Counts are computed live from question_version (cached counts are ignored).
 * status_history is appended in the same UPDATE.
 */
export async function POST() {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query(`
            WITH eligible AS (
                SELECT ps.paper_session_id
                FROM paper_session ps
                JOIN question_version qv ON qv.paper_session_id = ps.paper_session_id
                WHERE ps.status = 'NOT_REVIEWED'
                GROUP BY ps.paper_session_id
                HAVING COUNT(*) > 0
                   AND COUNT(*) = COUNT(*) FILTER (WHERE qv.status = 'MANUALLY_CORRECTED')
            )
            UPDATE paper_session ps
            SET
                status = 'TEAM_REVIEWED',
                status_history = COALESCE(ps.status_history, '[]'::jsonb) || jsonb_build_object(
                    'from',       'NOT_REVIEWED',
                    'to',         'TEAM_REVIEWED',
                    'changed_by', $1::int,
                    'at',         to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                    'source',     'maintenance:promote-fully-corrected'
                )::jsonb,
                updated_at = NOW()
            FROM eligible
            WHERE ps.paper_session_id = eligible.paper_session_id
            RETURNING ps.paper_session_id
        `, [user.id]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            updated_rows: result.rowCount,
            paper_session_ids: result.rows.map(r => r.paper_session_id),
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('maintenance/promote-fully-corrected error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
