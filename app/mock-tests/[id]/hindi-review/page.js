import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import HindiReview from '@/components/HindiReview';

export const dynamic = 'force-dynamic';

export default async function HindiReviewPage({ params }) {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');
    const { id } = await params;
    return <HindiReview mockTestId={id} />;
}
