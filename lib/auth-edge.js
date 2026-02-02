/**
 * Authentication utilities for Edge Runtime (Middleware)
 * Contains only JWT and Session logic, NO BCRYPT/NODE dependencies
 */

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecretKey() {
    const secret = process.env.SESSION_SECRET || 'your-super-secret-key-change-this';
    return new TextEncoder().encode(secret);
}

/**
 * Create a session token for a user
 */
export async function createSession(user) {
    const token = await new SignJWT({
        userId: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.is_admin || false,
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(getSecretKey());

    return token;
}

/**
 * Verify and decode a session token
 */
export async function verifySession(token) {
    try {
        const verified = await jwtVerify(token, getSecretKey());
        return verified.payload;
    } catch (err) {
        return null;
    }
}

/**
 * Get current user from session
 */
export async function getCurrentUser() {
    const cookieStore = await cookies();
    const token = cookieStore.get('session')?.value;

    if (!token) {
        return null;
    }

    const session = await verifySession(token);
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
