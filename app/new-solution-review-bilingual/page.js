import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import NewSolutionReviewBilingual from '@/components/NewSolutionReviewBilingual';
import { canAccessSolutionReview } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function NewSolutionReviewBilingualPage() {
    const user = await getCurrentUser();
    if (!canAccessSolutionReview(user)) {
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
        console.error('NewSolutionReviewBilingualPage DB error:', err);
    }

    return <NewSolutionReviewBilingual exams={exams} />;
}
