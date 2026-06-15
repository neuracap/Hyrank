import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import CglMockBuilder from '@/components/CglMockBuilder';

export const dynamic = 'force-dynamic';

/**
 * SSC CHSL Tier 1 mock builder — reuses the CGL builder UI driven by the
 * 'chsl-t1' spec. Same component, different examKey.
 */
export default async function ChslMockBuilderPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');

    return <CglMockBuilder examKey="chsl-t1" />;
}
