/**
 * Authentication utilities for user login and session management
 * Node.js Runtime only (Use auth-edge.js for Middleware)
 */

import bcrypt from 'bcryptjs';
// Re-export everything from auth-edge.js
export * from './auth-edge';

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password) {
    return bcrypt.hash(password, 10);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}
