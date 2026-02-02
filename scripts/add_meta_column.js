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
        console.log('--- Checking for meta_json column ---');
        const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'paper_session' AND column_name = 'meta_json'");

        if (res.rows.length === 0) {
            console.log('Column meta_json NOT found. Adding it...');
            await client.query("ALTER TABLE paper_session ADD COLUMN meta_json JSONB DEFAULT '{}'");
            console.log('Column added successfully.');
        } else {
            console.log('Column meta_json already exists.');
        }

    } catch (e) {
        console.error('Error modifying table:', e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
