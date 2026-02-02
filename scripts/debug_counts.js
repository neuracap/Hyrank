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
        const id = 'b6a9ef28-f61a-4808-b611-b1a9b1f88b86';
        const res = await pool.query(`
      SELECT count(*) FROM question_links WHERE paper_session_id_english = $1
    `, [id]);
        console.log('Count for specific ID:', res.rows[0].count);

        const res2 = await pool.query(`SELECT count(*) FROM question_links`);
        console.log('Total links in table:', res2.rows[0].count);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
