import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-edge';
import IssuesAdmin from '@/components/IssuesAdmin';

export const dynamic = 'force-dynamic';

export default async function IssuesPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');

    return (
        <div className="max-w-6xl mx-auto px-4 py-8">
            <IssuesAdmin />
        </div>
    );
}
