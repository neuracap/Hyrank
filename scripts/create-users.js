/**
 * Create user accounts for the 10 team members
 * Run this after the database migration is complete
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Define your 10 users here
const users = [
    { email: 'admin@hyrank.com', password: 'Admin@123', name: 'Admin User', isAdmin: true },
    { email: 'user1@hyrank.com', password: 'User@123', name: 'Editor 1', isAdmin: false },
    { email: 'user2@hyrank.com', password: 'User@123', name: 'Editor 2', isAdmin: false },
    { email: 'user3@hyrank.com', password: 'User@123', name: 'Editor 3', isAdmin: false },
    { email: 'user4@hyrank.com', password: 'User@123', name: 'Editor 4', isAdmin: false },
    { email: 'user5@hyrank.com', password: 'User@123', name: 'Editor 5', isAdmin: false },
    { email: 'user6@hyrank.com', password: 'User@123', name: 'Editor 6', isAdmin: false },
    { email: 'user7@hyrank.com', password: 'User@123', name: 'Editor 7', isAdmin: false },
    { email: 'user8@hyrank.com', password: 'User@123', name: 'Editor 8', isAdmin: false },
    { email: 'user9@hyrank.com', password: 'User@123', name: 'Editor 9', isAdmin: false },
];

async function createUsers() {
    console.log('Creating user accounts...\n');

    try {
        for (const user of users) {
            try {
                // Hash password
                const passwordHash = await bcrypt.hash(user.password, 10);

                // Insert user
                const result = await pool.query(
                    `INSERT INTO users (email, password_hash, name, is_admin)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, name, is_admin`,
                    [user.email.toLowerCase(), passwordHash, user.name, user.isAdmin]
                );

                const created = result.rows[0];
                console.log(`✅ Created user: ${created.email} (${created.name})${created.is_admin ? ' [ADMIN]' : ''}`);
                console.log(`   Password: ${user.password}`);
                console.log('');
            } catch (error) {
                if (error.code === '23505') {
                    // Unique constraint violation
                    console.log(`⚠️  User ${user.email} already exists, skipping...`);
                } else {
                    console.error(`❌ Error creating user ${user.email}:`, error.message);
                }
            }
        }

        console.log('\n✅ User creation complete!');
        console.log('\nNext steps:');
        console.log('1. Share login credentials with team members');
        console.log('2. Users should change their passwords after first login');
        console.log('3. Start assigning work via the admin dashboard\n');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await pool.end();
    }
}

createUsers();
