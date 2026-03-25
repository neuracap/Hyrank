import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/solution-review/papers?exam_id=xxx&language=EN
 * Returns papers filtered by exam and language with solution stats.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const examId = searchParams.get('exam_id');
    const language = searchParams.get('language') || 'EN';

    if (!examId) {
        return NextResponse.json({ error: 'exam_id is required' }, { status: 400 });
    }

    try {
        const result = await db.query(`
            SELECT
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.subject,
                ps.status,
                ps.language,
                COUNT(qv.question_id) AS question_count,
                COUNT(qv.question_id) FILTER (WHERE qv.solution_status = 'DONE') AS solved_count,
                COUNT(qv.question_id) FILTER (WHERE COALESCE(qv.solution_status, 'pending') IN ('pending', 'FAILED')) AS unsolved_count
            FROM paper_session ps
            LEFT JOIN question_version qv
                ON qv.paper_session_id = ps.paper_session_id
                AND qv.language = $2
            WHERE ps.exam_id = $1
              AND ps.language = $2
            GROUP BY ps.paper_session_id, ps.session_label, ps.paper_date,
                     ps.subject, ps.status, ps.language
            HAVING COUNT(qv.question_id) > 0
            ORDER BY ps.paper_date DESC NULLS LAST, ps.session_label ASC
        `, [examId, language.toUpperCase()]);

        return NextResponse.json({ papers: result.rows });
    } catch (e) {
        console.error('solution-review/papers error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
