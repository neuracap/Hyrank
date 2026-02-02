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

        console.log('--- Tests ---');
        const tests = await client.query('SELECT test_id, title FROM test LIMIT 5');
        console.log(JSON.stringify(tests.rows, null, 2));

        console.log('--- Assets ---');
        // Check finding an asset based on filename if possible, or just list some
        const assets = await client.query('SELECT * FROM asset LIMIT 2');
        console.log(JSON.stringify(assets.rows, null, 2));

        client.release();
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
