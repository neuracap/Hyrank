const { Pool } = require('pg');
const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function run() {
    const client = await pool.connect();
    try {
        console.log('--- Asset Table Columns ---');
        const cols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'asset'");
        console.log(JSON.stringify(cols.rows, null, 2));

        console.log('\n--- Sample Asset Rows ---');
        const sample = await client.query('SELECT * FROM asset LIMIT 3');
        console.log(JSON.stringify(sample.rows, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
