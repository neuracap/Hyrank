const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log('Checking captions...');
        const res = await pool.query(`
            SELECT paper_session_id, caption 
            FROM paper_session 
            WHERE caption ILIKE '%SSC CGL%'
            LIMIT 5
        `);
        console.log(`Found ${res.rows.length} rows matching '%SSC CGL%'. Sample:`);
        console.table(res.rows);

        console.log('Checking Question Links for these...');
        const linksRes = await pool.query(`
            SELECT COUNT(*) 
            FROM question_links ql
            JOIN paper_session pse ON ql.paper_session_id_english = pse.paper_session_id
            WHERE pse.caption ILIKE '%SSC CGL%'
        `);
        console.log(`Links with English SSC CGL session: ${linksRes.rows[0].count}`);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
