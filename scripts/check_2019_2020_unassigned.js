const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    try {
        const query = `
            SELECT 
                ra.paper_session_id, 
                ps.paper_date,
                (SELECT COUNT(*) FROM question_links ql WHERE ql.paper_session_id_english = ra.paper_session_id AND ql.status = 'MANUALLY_CORRECTED') as corrected_count
            FROM review_assignments ra
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
            WHERE EXTRACT(YEAR FROM ps.paper_date) IN (2019, 2020)
              AND NOT EXISTS (
                  SELECT 1 
                  FROM question_links ql 
                  WHERE ql.paper_session_id_english = ra.paper_session_id 
                    AND ql.status = 'MANUALLY_CORRECTED'
              )
        `;

        const res = await pool.query(query);
        console.log(`Found ${res.rowCount} assigned 2019/2020 papers with 0 manually corrected questions.`);
        if (res.rowCount > 0) {
            console.log('Sample of papers that would be unassigned:');
            console.table(res.rows.slice(0, 5));
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

check();
