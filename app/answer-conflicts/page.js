import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import AnswerConflicts from '@/components/AnswerConflicts';

export const dynamic = 'force-dynamic';

export default async function AnswerConflictsPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');

    return <AnswerConflicts />;
}
