import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-edge';
import AdminMaintenance from '@/components/AdminMaintenance';

export const dynamic = 'force-dynamic';

export default async function MaintenancePage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');

    return (
        <div className="max-w-7xl mx-auto px-4 py-8">
            <AdminMaintenance />
        </div>
    );
}
