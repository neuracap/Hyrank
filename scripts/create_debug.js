const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log('Attempting CREATE TABLE...');
        await pool.query(`
            CREATE TABLE review_assignments (
                id SERIAL PRIMARY KEY,
                paper_session_id UUID NOT NULL,
                reviewer_id INTEGER NOT NULL,
                assigned_at TIMESTAMP DEFAULT NOW(),
                status TEXT DEFAULT 'PENDING'
            );
        `);
        console.log('Table created.');
    } catch (e) {
        console.log('ERROR_MESSAGE_START');
        console.log(e.message);
        console.log(e.code);
        console.log('ERROR_MESSAGE_END');
    } finally {
        await pool.end();
    }
}
run();
