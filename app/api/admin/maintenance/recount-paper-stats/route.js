import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/admin/maintenance/recount-paper-stats
 * Recalculates all 5 count columns on paper_session from question_version.
 * Optionally scoped to a single paper_session_id via body: { paper_session_id }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let paper_session_id = null;
    try {
        const body = await req.json().catch(() => ({}));
        paper_session_id = body.paper_session_id || null;
    } catch {
        // no body — run for all
    }

    try {
        const whereClause = paper_session_id
            ? 'AND qv.paper_session_id = $1'
            : '';
        const params = paper_session_id ? [paper_session_id] : [];

        const result = await db.query(`
            UPDATE paper_session ps
            SET
                total_question_count              = sub.total,
                manually_corrected_count          = sub.mc_count,
                manually_corrected_no_image_count = sub.mc_no_image_count,
                ready_for_solution_count          = sub.ready_count,
                solution_done_count               = sub.done_count,
                updated_at                        = NOW()
            FROM (
                SELECT
                    qv.paper_session_id,
                    COUNT(DISTINCT qv.question_id)                                                                             AS total,
                    COUNT(DISTINCT CASE WHEN qv.status = 'MANUALLY_CORRECTED'                           THEN qv.question_id END) AS mc_count,
                    COUNT(DISTINCT CASE WHEN qv.status = 'MANUALLY_CORRECTED' AND qv.has_image = false  THEN qv.question_id END) AS mc_no_image_count,
                    COUNT(DISTINCT CASE WHEN qv.status = 'MANUALLY_CORRECTED'
                                         AND (qv.solution_status IS NULL OR qv.solution_status != 'DONE') THEN qv.question_id END) AS ready_count,
                    COUNT(DISTINCT CASE WHEN qv.solution_status = 'DONE'                                THEN qv.question_id END) AS done_count
                FROM question_version qv
                WHERE qv.paper_session_id IS NOT NULL
                ${whereClause}
                GROUP BY qv.paper_session_id
            ) sub
            WHERE ps.paper_session_id = sub.paper_session_id
        `, params);

        return NextResponse.json({
            success: true,
            updated_rows: result.rowCount,
            scope: paper_session_id ?? 'all',
        });

    } catch (e) {
        console.error('maintenance/recount-paper-stats error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
