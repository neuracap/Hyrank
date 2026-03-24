import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import SolutionReview from '@/components/SolutionReview';

export const dynamic = 'force-dynamic';

export default async function SolutionReviewPage() {
    const user = await getCurrentUser();
    if (!user || !user.isAdmin) {
        redirect('/login');
    }

    return <SolutionReview />;
}
