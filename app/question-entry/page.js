import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-edge';
import Navigation from '@/components/Navigation';
import QuestionEntry from '@/components/QuestionEntry';

export const dynamic = 'force-dynamic';

export default async function QuestionEntryPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');

    return (
        <>
            <Navigation user={user} />
            <div className="max-w-7xl mx-auto px-4 py-6">
                <QuestionEntry />
            </div>
        </>
    );
}
