import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import CurrentAffairsAdmin from '@/components/CurrentAffairsAdmin';

export const dynamic = 'force-dynamic';

export default async function CurrentAffairsAdminPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');
    return <CurrentAffairsAdmin />;
}
