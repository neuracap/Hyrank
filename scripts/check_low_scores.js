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
      SELECT count(*) 
      FROM question_links
      WHERE updated_score IS NOT NULL AND updated_score < 0.8;
    `);
        console.log('Low score count:', res.rows[0].count);

        const res2 = await pool.query(`
        SELECT count(*) 
        FROM question_links
        WHERE updated_score IS NOT NULL;
    `);
        console.log('Total with updated_score:', res2.rows[0].count);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
