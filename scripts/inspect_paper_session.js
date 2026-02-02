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
        const resPaperSession = await pool.query(`
            SELECT column_name
            FROM information_schema.columns 
            WHERE table_name = 'paper_session';
        `);
        console.log('--- paper_session columns ---');
        console.log(resPaperSession.rows.map(r => r.column_name).join('\n'));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
