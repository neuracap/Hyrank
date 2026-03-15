import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-edge';
import DailyQuizAdmin from '@/components/DailyQuizAdmin';

export const dynamic = 'force-dynamic';

export default async function DailyQuizAdminPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');

    return (
        <div className="max-w-7xl mx-auto px-4 py-6">
            <DailyQuizAdmin />
        </div>
    );
}
