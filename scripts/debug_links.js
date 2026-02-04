const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log('Fetching 1 link...');
        const res = await pool.query(`
            SELECT paper_session_id_english, paper_session_id_hindi 
            FROM question_links 
            LIMIT 1
        `);

        if (res.rows.length === 0) {
            console.log('No links found.');
            return;
        }

        const link = res.rows[0];
        console.log('Found link:', link);

        console.log('Fetching English Paper Session...');
        const paperRes = await pool.query(`
            SELECT * FROM paper_session WHERE paper_session_id = $1
        `, [link.paper_session_id_english]);

        console.log('Paper Session Data:');
        console.log(paperRes.rows[0]);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
