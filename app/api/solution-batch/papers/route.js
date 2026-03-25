import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

export async function GET() {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await db.query(`
            SELECT
                ps.paper_session_id,
                e.name AS exam_name,
                ps.session_name,
                ps.language,
                ps.status AS paper_status,
                COUNT(*) FILTER (
                    WHERE COALESCE(qv.solution_status, 'pending') IN ('pending', 'FAILED')
                ) AS eligible_count,
                COUNT(*) FILTER (
                    WHERE qv.solution_status = 'BATCH_SUBMITTED'
                ) AS submitted_count,
                COUNT(*) FILTER (
                    WHERE qv.solution_status = 'DONE'
                ) AS done_count,
                COUNT(*) AS total_count
            FROM paper_session ps
            JOIN exam e ON e.exam_id = ps.exam_id
            JOIN question_version qv ON qv.paper_session_id = ps.paper_session_id
            WHERE ps.status IN ('MISSING_ADDED', 'ADMIN_REVIEWED')
              AND qv.status = 'MANUALLY_CORRECTED'
              AND qv.has_image = false
            GROUP BY ps.paper_session_id, e.name, ps.session_name, ps.language, ps.status
            HAVING COUNT(*) FILTER (
                WHERE COALESCE(qv.solution_status, 'pending') IN ('pending', 'FAILED')
            ) > 0
            ORDER BY
                CASE WHEN ps.status = 'MISSING_ADDED' THEN 1
                     WHEN ps.status = 'ADMIN_REVIEWED' THEN 2
                     ELSE 3 END,
                COUNT(*) FILTER (
                    WHERE COALESCE(qv.solution_status, 'pending') IN ('pending', 'FAILED')
                ) DESC
        `);

        return NextResponse.json({ papers: result.rows });
    } catch (e) {
        console.error('solution-batch/papers error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
