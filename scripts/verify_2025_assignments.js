const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function verifyAssignments() {
    try {
        console.log('Verifying 2025 assignments...');

        const res = await pool.query(`
            SELECT u.email, COUNT(ra.paper_session_id) as assigned_count
            FROM review_assignments ra
            JOIN users u ON ra.reviewer_id = u.id
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
            WHERE EXTRACT(YEAR FROM ps.paper_date) = 2025
            GROUP BY u.email
            ORDER BY u.email
        `);

        console.table(res.rows);

        const total = res.rows.reduce((sum, row) => sum + parseInt(row.assigned_count), 0);
        console.log(`Total 2025 papers assigned: ${total}`);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

verifyAssignments();
