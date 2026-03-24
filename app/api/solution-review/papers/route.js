import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export async function GET() {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await db.query(`
            SELECT
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.subject,
                ps.status,
                e.name AS exam_name,
                COUNT(qv.question_id) AS question_count,
                COUNT(qv.question_id) FILTER (
                    WHERE qv.solution_json->>'answer_label' IS NOT NULL
                      AND qv.solution_json->>'answer_label' != ''
                ) AS solution_count
            FROM paper_session ps
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            LEFT JOIN question_version qv
                ON qv.paper_session_id = ps.paper_session_id
                AND qv.language = 'EN'
            GROUP BY ps.paper_session_id, ps.session_label, ps.paper_date,
                     ps.subject, ps.status, e.name
            HAVING COUNT(qv.question_id) > 0
               AND COUNT(qv.question_id) = COUNT(qv.question_id) FILTER (
                    WHERE qv.solution_json->>'answer_label' IS NOT NULL
                      AND qv.solution_json->>'answer_label' != ''
                )
               AND ps.status NOT IN ('SOLUTION_REVIEW', 'PRODUCTION')
            ORDER BY ps.paper_date DESC NULLS LAST
        `);

        return NextResponse.json({ papers: result.rows });
    } catch (e) {
        console.error('Solution review papers fetch error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
