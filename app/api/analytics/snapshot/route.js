import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * POST /api/analytics/snapshot
 * Take a daily snapshot of each editor's progress.
 * Callable by cron (x-cron-key) or admin session.
 * Upserts into editor_daily_progress for today's date.
 */
export async function POST(req) {
    const cronKey = req.headers.get('x-cron-key');
    const envSecret = process.env.CRON_SECRET;
    const isValidCron = cronKey && envSecret && cronKey === envSecret;

    if (!isValidCron) {
        const user = await getCurrentUser();
        if (!user?.isAdmin) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    try {
        // Snapshot current state for each reviewer
        const result = await db.query(`
            INSERT INTO editor_daily_progress (snapshot_date, user_id, papers_assigned, papers_reviewed,
                total_questions, corrected_questions, flagged_questions)
            SELECT
                CURRENT_DATE,
                u.id,
                COUNT(DISTINCT ra.id),
                COUNT(DISTINCT ra.id) FILTER (WHERE ps.status IN ('TEAM_REVIEWED','ADMIN_REVIEWED','MISSING_ADDED','PRE_PUBLISH_READY','SOLUTION_REVIEW','PRODUCTION')),
                COALESCE(SUM(qv_s.total_q), 0),
                COALESCE(SUM(qv_s.corrected_q), 0),
                COALESCE(SUM(qv_s.flagged_q), 0)
            FROM users u
            JOIN review_assignments ra ON ra.reviewer_id = u.id
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
            LEFT JOIN (
                SELECT paper_session_id,
                       COUNT(*) AS total_q,
                       COUNT(*) FILTER (WHERE status = 'MANUALLY_CORRECTED') AS corrected_q,
                       COUNT(*) FILTER (WHERE status = 'FLAGGED') AS flagged_q
                FROM question_version
                GROUP BY paper_session_id
            ) qv_s ON qv_s.paper_session_id = ra.paper_session_id
            GROUP BY u.id
            ON CONFLICT (snapshot_date, user_id)
            DO UPDATE SET
                papers_assigned = EXCLUDED.papers_assigned,
                papers_reviewed = EXCLUDED.papers_reviewed,
                total_questions = EXCLUDED.total_questions,
                corrected_questions = EXCLUDED.corrected_questions,
                flagged_questions = EXCLUDED.flagged_questions,
                updated_at = NOW()
        `);

        return NextResponse.json({ success: true, rows_upserted: result.rowCount });
    } catch (e) {
        console.error('analytics/snapshot error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
