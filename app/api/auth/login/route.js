import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { verifyPassword, createSession, setSessionCookie } from '@/lib/auth';

export async function POST(request) {
    try {
        const { email, password } = await request.json();

        if (!email || !password) {
            return NextResponse.json(
                { error: 'Email and password are required' },
                { status: 400 }
            );
        }

        // Find user by email
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        const user = result.rows[0];

        if (!user) {
            return NextResponse.json(
                { error: 'Invalid email or password' },
                { status: 401 }
            );
        }

        // Verify password
        const isValid = await verifyPassword(password, user.password_hash);

        if (!isValid) {
            return NextResponse.json(
                { error: 'Invalid email or password' },
                { status: 401 }
            );
        }

        // Update last login time
        await pool.query(
            'UPDATE users SET last_login = NOW() WHERE id = $1',
            [user.id]
        );

        // Create session token with sanitized payload
        const sessionPayload = {
            id: user.id,
            email: user.email,
            name: user.name,
            isAdmin: user.is_admin || false, // Normalize to isAdmin
        };
        const token = await createSession(sessionPayload);

        // Set session cookie
        await setSessionCookie(token);

        return NextResponse.json({
            success: true,
            user: sessionPayload,
        });
    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json(
            { error: 'An error occurred during login' },
            { status: 500 }
        );
    }
}
