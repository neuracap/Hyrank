const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function createTable() {
    try {
        console.log('Creating review_assignments table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS review_assignments (
                id SERIAL PRIMARY KEY,
                paper_session_id UUID NOT NULL UNIQUE REFERENCES paper_session(paper_session_id),
                reviewer_id INTEGER NOT NULL REFERENCES users(id),
                assigned_at TIMESTAMP DEFAULT NOW(),
                status TEXT DEFAULT 'PENDING'
            );
        `);
        console.log('✅ Table created successfully.');
    } catch (e) {
        console.error('❌ Error creating table:', e);
    } finally {
        await pool.end();
    }
}

createTable();
