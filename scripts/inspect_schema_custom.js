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
        const resQuestionVersion = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'question_version';
    `);
        console.log('--- question_version columns ---');
        console.log(resQuestionVersion.rows.map(r => r.column_name).join('\n'));

        const resPaperSession = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'paper_session';
    `);
        console.log('\n--- paper_session columns ---');
        console.log(resPaperSession.rows.map(r => r.column_name).join(', '));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
