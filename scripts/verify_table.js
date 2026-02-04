const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function verify() {
    try {
        const res = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'review_assignments'
        `);
        if (res.rows.length > 0) {
            console.log('✅ Table review_assignments exists.');
        } else {
            console.log('❌ Table review_assignments DOES NOT exist.');
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
verify();
