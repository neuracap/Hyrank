const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433, // Found from previous context or standard
});

async function run() {
    const client = await pool.connect();
    try {
        // Get columns
        const colRes = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'asset'
        `);
        console.log("COLUMNS:", colRes.rows.map(r => r.column_name));

        // Get sample values for asset_type
        const valRes = await client.query(`
            SELECT DISTINCT asset_type FROM asset LIMIT 10
        `);
        console.log("DISTINCT asset_types:", valRes.rows);
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
