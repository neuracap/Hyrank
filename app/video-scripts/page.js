import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import VideoScriptsReview from '@/components/VideoScriptsReview';

export const dynamic = 'force-dynamic';

export default async function VideoScriptsPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');
    return <VideoScriptsReview />;
}
