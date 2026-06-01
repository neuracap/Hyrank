import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import CglMockBuilder from '@/components/CglMockBuilder';

export const dynamic = 'force-dynamic';

export default async function CglMockBuilderPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');

    return <CglMockBuilder />;
}
