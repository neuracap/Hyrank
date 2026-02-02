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
      SELECT paper_session_id_english, COUNT(*) as count
      FROM question_links
      GROUP BY paper_session_id_english
      ORDER BY count DESC
      LIMIT 5;
    `);
        console.log('--- Sessions with Links ---');
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
