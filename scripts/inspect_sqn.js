const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function inspect() {
    try {
        const client = await pool.connect();
        const res = await client.query('SELECT source_question_no FROM question_version WHERE source_question_no IS NOT NULL LIMIT 20');
        console.log('Values:', res.rows.map(r => r.source_question_no));
        client.release();
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
