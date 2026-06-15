import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import CglMockBuilder from '@/components/CglMockBuilder';

export const dynamic = 'force-dynamic';

/**
 * SSC GD Constable mock builder — reuses the CGL builder UI driven by the
 * 'gd' spec (5 sections × 20Q with a HINDI section, PYQ pool restricted to
 * GD + CGL).
 */
export default async function GdMockBuilderPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');

    return <CglMockBuilder examKey="gd" />;
}
