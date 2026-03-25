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

    let exams = [];
    try {
        const res = await db.query(`
            SELECT e.exam_id, e.name
            FROM exam e
            WHERE EXISTS (
                SELECT 1 FROM paper_session ps WHERE ps.exam_id = e.exam_id
            )
            ORDER BY e.name ASC
        `);
        exams = res.rows;
    } catch (err) {
        console.error('SolutionReviewPage DB error:', err);
    }

    return <SolutionReview exams={exams} />;
}
