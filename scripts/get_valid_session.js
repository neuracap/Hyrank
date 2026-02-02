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
      SELECT paper_session_id_english, count(*)
      FROM question_links
      GROUP BY paper_session_id_english
      ORDER BY count DESC
      LIMIT 1
    `);
        if (res.rows.length > 0) {
            console.log('VALID_SESSION_ID:', res.rows[0].paper_session_id_english);
            console.log('COUNT:', res.rows[0].count);
        } else {
            console.log('No sessions found with links');
        }
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
