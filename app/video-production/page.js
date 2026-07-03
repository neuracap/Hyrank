import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import VideoProductionBoard from '@/components/VideoProductionBoard';

export const dynamic = 'force-dynamic';

export default async function VideoProductionPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');
    return <VideoProductionBoard />;
}
