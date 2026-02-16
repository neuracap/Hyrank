const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function listReviewers() {
    try {
        console.log('Listing top 5 reviewers...');
        const res = await pool.query(`
            SELECT id, email FROM users 
            ORDER BY id ASC
            LIMIT 5
        `);
        console.log(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

listReviewers();
