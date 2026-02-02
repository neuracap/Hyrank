/**
 * Pure JWT Utilities - Dependency Free (No next/* imports)
 * Safe for Edge Middleware and Node.js
 */

import { SignJWT, jwtVerify } from 'jose';

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

// Lazy load secret to avoid init-time crashes in Edge
function getSecretKey() {
    const secret = process.env.SESSION_SECRET || 'your-super-secret-key-change-this';
    return new TextEncoder().encode(secret);
}

/**
 * Create a session token for a user
 */
export async function createSessionToken(user) {
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
export async function verifySessionToken(token) {
    try {
        const verified = await jwtVerify(token, getSecretKey());
        return verified.payload;
    } catch (err) {
        return null;
    }
}
