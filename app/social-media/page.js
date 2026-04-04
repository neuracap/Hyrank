import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import SocialMediaManager from '@/components/SocialMediaManager';

export const dynamic = 'force-dynamic';

export default async function SocialMediaPage() {
    const user = await getCurrentUser();
    if (!user?.isAdmin) redirect('/login');
    return <SocialMediaManager />;
}
