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
        const exams = await client.query('SELECT * FROM exam LIMIT 10');
        console.log('--- Exams ---');
        console.log(JSON.stringify(exams.rows, null, 2));
        client.release();
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
