const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function unassign() {
    try {
        const query = `
            DELETE FROM review_assignments
            WHERE paper_session_id IN (
                SELECT ra.paper_session_id
                FROM review_assignments ra
                JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
                WHERE EXTRACT(YEAR FROM ps.paper_date) IN (2019, 2020)
                  AND NOT EXISTS (
                      SELECT 1 
                      FROM question_links ql 
                      WHERE (ql.paper_session_id_english = ra.paper_session_id 
                         OR ql.paper_session_id_hindi = ra.paper_session_id)
                        AND ql.status = 'MANUALLY_CORRECTED'
                  )
            )
            RETURNING paper_session_id;
        `;
        // Notice I updated the subquery slightly to ensure it checks both EN/HI links correctly.

        const res = await pool.query(query);
        console.log(`✅ Successfully deleted ${res.rowCount} unstarted 2019/2020 reviewer assignments.`);
    } catch (e) {
        console.error('❌ Error executing unassignment:', e);
    } finally {
        await pool.end();
    }
}

unassign();
