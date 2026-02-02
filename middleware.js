import { NextResponse } from 'next/server';

// TEMPORARILY DISABLED: Middleware authentication causing Edge Runtime crashes
// TODO: Re-implement auth using Server Components instead of Middleware

export async function middleware(request) {
    // Allow all requests through for now
    return NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|public).*)',
    ],
};
