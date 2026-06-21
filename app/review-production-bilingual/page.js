import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import ReviewProductionBilingual from '@/components/ReviewProductionBilingual';
import { canAccessSolutionReview } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function ReviewProductionBilingualPage() {
    const user = await getCurrentUser();
    if (!canAccessSolutionReview(user)) {
        redirect('/login');
    }

    let exams = [];
    try {
        // Only surface exams that actually have at least one PRODUCTION
        // paper pair, so the dropdown doesn't list noise.
        const res = await db.query(`
            SELECT DISTINCT e.exam_id, e.name
            FROM exam e
            JOIN paper_session ps ON ps.exam_id = e.exam_id
            WHERE ps.status = 'PRODUCTION'
            ORDER BY e.name ASC
        `);
        exams = res.rows;
    } catch (err) {
        console.error('ReviewProductionBilingualPage DB error:', err);
    }

    return <ReviewProductionBilingual exams={exams} />;
}
