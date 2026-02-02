const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function run() {
    try {
        const res = await pool.query(`
      SELECT paper_session_id_english
      FROM question_links
      LIMIT 1;
    `);
        if (res.rows.length > 0) {
            console.log('SESSION_ID:', res.rows[0].paper_session_id_english);
        } else {
            console.log('No sessions found in question_links');
            // Fallback: get any paper session just to test the page (it will show empty but the page shouldn't crash)
            const res2 = await pool.query(`SELECT paper_session_id FROM paper_session LIMIT 1`);
            if (res2.rows.length > 0) {
                console.log('FALLBACK_SESSION_ID:', res2.rows[0].paper_session_id);
            }
        }
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
