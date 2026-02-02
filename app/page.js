import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Home() {
    // Redirect to login page
    redirect('/login');
}
