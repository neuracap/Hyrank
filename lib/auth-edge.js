/**
 * Authentication utilities for Edge Runtime (Middleware)
 * Contains only JWT and Session logic, NO BCRYPT/NODE dependencies
 */

import { cookies } from 'next/headers';
import { createSessionToken, verifySessionToken } from './jwt-utils';

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

// Export base functions for consumers
export { createSessionToken as createSession, verifySessionToken as verifySession };

/**
 * Get current user from session
 */
export async function getCurrentUser() {
    const cookieStore = await cookies();
    const token = cookieStore.get('session')?.value;

    if (!token) {
        return null;
    }

    const session = await verifySessionToken(token);
    return session;
}

/**
 * Set session cookie
 */
export async function setSessionCookie(token) {
    const cookieStore = await cookies();
    cookieStore.set('session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_DURATION,
        path: '/',
    });
}

/**
 * Clear session cookie (logout)
 */
export async function clearSessionCookie() {
    const cookieStore = await cookies();
    cookieStore.delete('session');
}

/**
 * Require authentication - use in server components/actions
 */
export async function requireAuth() {
    const user = await getCurrentUser();
    if (!user) {
        throw new Error('Unauthorized');
    }
    return user;
}

/**
 * Require admin access
 */
export async function requireAdmin() {
    const user = await requireAuth();
    if (!user.isAdmin) {
        throw new Error('Admin access required');
    }
    return user;
}
