/**
 * Script to create admin1 and admin2 user accounts
 *
 * Usage: node scripts/create_admin_users.js
 *
 * Requires DATABASE_URL env var (or .env file)
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway') || process.env.DATABASE_URL?.includes('supabase')
        ? { rejectUnauthorized: false }
        : false
});

async function createAdminUsers() {
    const admins = [
        { email: 'admin1@hyrank.com', name: 'Admin 1', password: 'Admin@123' },
        { email: 'admin2@hyrank.com', name: 'Admin 2', password: 'Admin@123' },
    ];

    const client = await pool.connect();

    try {
        for (const admin of admins) {
            // Check if user already exists
            const existing = await client.query(
                'SELECT id, email FROM users WHERE email = $1',
                [admin.email]
            );

            if (existing.rows.length > 0) {
                console.log(`User ${admin.email} already exists (id=${existing.rows[0].id}), skipping.`);
                continue;
            }

            const passwordHash = await bcrypt.hash(admin.password, 10);

            const result = await client.query(
                `INSERT INTO users (email, password_hash, name, is_admin, created_at)
                 VALUES ($1, $2, $3, true, NOW())
                 RETURNING id, email, name`,
                [admin.email, passwordHash, admin.name]
            );

            console.log(`Created admin user: ${result.rows[0].email} (id=${result.rows[0].id})`);
            console.log(`  Password: ${admin.password}`);
        }

        console.log('\nDone!');
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        client.release();
        await pool.end();
    }
}

createAdminUsers();
