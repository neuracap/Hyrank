import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import SolutionReview from '@/components/SolutionReview';

export const dynamic = 'force-dynamic';

export default async function SolutionReviewPage() {
    const user = await getCurrentUser();
    if (!user || !user.isAdmin) {
        redirect('/login');
    }

    let papers = [];
    let client;
    try {
        client = await db.connect();
        const res = await client.query(`
            SELECT
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.subject,
                ps.status,
                e.name AS exam_name,
                COUNT(qv.question_id) AS question_count
            FROM paper_session ps
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            LEFT JOIN question_version qv
                ON qv.paper_session_id = ps.paper_session_id
                AND qv.language = 'EN'
            WHERE ps.solution_done_count >= 90
            GROUP BY ps.paper_session_id, ps.session_label, ps.paper_date, ps.subject, ps.status, e.name, ps.solution_done_count
            ORDER BY ps.paper_date DESC NULLS LAST
        `);
        papers = res.rows;
    } catch (err) {
        console.error('SolutionReviewPage DB error:', err);
    } finally {
        client?.release();
    }

    return <SolutionReview papers={papers} />;
}
