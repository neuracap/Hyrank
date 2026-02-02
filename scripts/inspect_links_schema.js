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
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'question_links';
    `);
        console.log('--- question_links columns ---');
        console.log('--- question_links columns ---');
        console.log(res.rows.map(r => r.column_name).join('\n'));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
