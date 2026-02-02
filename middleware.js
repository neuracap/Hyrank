import { NextResponse } from 'next/server';
import { verifySession } from './lib/auth-edge';

export async function middleware(request) {
    // console.log('Middleware running on path:', request.nextUrl.pathname);
    const { pathname } = request.nextUrl;

    // Public paths that don't require authentication
    const publicPaths = ['/login', '/api/auth/login'];

    // Check if the path is public
    const isPublicPath = publicPaths.some(path => pathname.startsWith(path));

    if (isPublicPath) {
        return NextResponse.next();
    }

    // Check for session (Use request.cookies in Middleware, NOT next/headers)
    const token = request.cookies.get('session')?.value;
    const user = token ? await verifySession(token) : null;

    if (!user) {
        // Redirect to login if not authenticated
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // User is authenticated, continue
    return NextResponse.next();
}

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - public files (public folder)
         */
        '/((?!_next/static|_next/image|favicon.ico|public).*)',
    ],
};
