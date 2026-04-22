import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mock-blueprint/available-years?exam_id=xxx
 * Returns distinct years that have EN papers for an exam,
 * along with the count of paper sessions per year.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const exam_id = searchParams.get('exam_id');
    if (!exam_id) {
        return NextResponse.json({ error: 'exam_id is required' }, { status: 400 });
    }

    try {
        const res = await db.query(`
            SELECT
                EXTRACT(YEAR FROM ps.paper_date)::int AS year,
                COUNT(DISTINCT ps.paper_session_id)   AS paper_count,
                COUNT(qv.question_id)                 AS question_count
            FROM paper_session ps
            JOIN question_version qv ON qv.paper_session_id = ps.paper_session_id
                AND qv.language = 'EN'
                AND qv.status = 'MANUALLY_CORRECTED'
            WHERE ps.exam_id = $1
              AND ps.paper_date IS NOT NULL
            GROUP BY year
            ORDER BY year DESC
        `, [exam_id]);

        return NextResponse.json({ years: res.rows });
    } catch (e) {
        console.error('mock-blueprint/available-years error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
