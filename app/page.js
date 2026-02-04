import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

export default async function Home() {
    let user = null;
    try {
        user = await getCurrentUser();
    } catch (e) {
        console.error('Auth error in Home:', e);
    }

    if (user) {
        redirect('/dashboard');
    } else {
        redirect('/login');
    }
}
