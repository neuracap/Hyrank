const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log('Running query...');
        const res = await pool.query(`
            SELECT DISTINCT 
                ql.paper_session_id_english as eng_id, 
                pse.name as eng_name
            FROM question_links ql
            JOIN paper_session pse ON ql.paper_session_id_english = pse.paper_session_id
            LIMIT 1
        `);
        console.log('Query success:', res.rows);
    } catch (e) {
        console.log('ERROR_START');
        console.log(e.message);
        console.log(e.hint);
        console.log('ERROR_END');
    } finally {
        await pool.end();
    }
}
run();
