import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

export async function POST() {
    await clearSessionCookie();

    return NextResponse.json({ success: true });
}

export async function GET() {
    await clearSessionCookie();

    return NextResponse.redirect('/login');
}
