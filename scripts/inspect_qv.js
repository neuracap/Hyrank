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
        const res = await client.query('SELECT * FROM question_version LIMIT 1');
        console.log('Columns:', Object.keys(res.rows[0]));
        console.log('Sample:', JSON.stringify(res.rows[0], null, 2));
        client.release();
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
