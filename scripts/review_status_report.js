const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function report() {
    try {
        console.log('\n=== REVIEWER PROGRESS REPORT ===\n');

        // Summary by Reviewer
        const summary = await pool.query(`
            SELECT 
                u.name,
                u.email,
                COUNT(ra.id) as total_assigned,
                COUNT(CASE WHEN ra.status = 'COMPLETED' THEN 1 END) as completed,
                COUNT(CASE WHEN ra.status = 'PENDING' THEN 1 END) as pending
            FROM review_assignments ra
            JOIN users u ON ra.reviewer_id = u.id
            GROUP BY u.id, u.name, u.email
            ORDER BY u.name
        `);

        console.table(summary.rows);

        // Detailed Breakdown per Reviewer
        console.log('\n--- Detailed Assignments ---');

        const details = await pool.query(`
            SELECT 
                u.email,
                ps.caption as paper_name,
                ps.language,
                ra.status,
                ra.assigned_at
            FROM review_assignments ra
            JOIN users u ON ra.reviewer_id = u.id
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
            ORDER BY u.email, ra.status, ps.language
        `);

        // Group by user for cleaner output
        let currentUser = null;
        details.rows.forEach(row => {
            if (currentUser !== row.email) {
                console.log(`\nReviewer: ${row.email}`);
                currentUser = row.email;
            }
            const statusIcon = row.status === 'COMPLETED' ? '✅' : '⏳';
            console.log(`  ${statusIcon} [${row.language}] ${row.paper_name} (${row.status})`);
        });
        console.log('\n');

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

report();
