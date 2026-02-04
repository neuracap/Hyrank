const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log('Verifying assignments...');
        const res = await pool.query(`
            SELECT 
                u.email,
                COUNT(ra.id) as assigned_count,
                STRING_AGG(ps.caption, ', ') as samples
            FROM review_assignments ra
            JOIN users u ON ra.reviewer_id = u.id
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
            GROUP BY u.email
            ORDER BY u.email
        `);
        console.table(res.rows);

        const total = await pool.query("SELECT COUNT(*) FROM review_assignments");
        console.log(`Total assignments: ${total.rows[0].count}`);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
