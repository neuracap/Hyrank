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
        const cols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'paper_session'");
        console.log(JSON.stringify(cols.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
