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
        console.log('--- question_asset_map Table Columns ---');
        const cols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'question_asset_map'");
        console.log(JSON.stringify(cols.rows, null, 2));

        console.log('\n--- Sample question_asset_map Rows ---');
        const sample = await client.query('SELECT * FROM question_asset_map LIMIT 5');
        console.log(JSON.stringify(sample.rows, null, 2));

        console.log('\n--- Sample with asset details ---');
        const withAsset = await client.query(`
            SELECT qam.*, a.original_name, a.local_path 
            FROM question_asset_map qam
            JOIN asset a ON qam.asset_id = a.asset_id
            LIMIT 3
        `);
        console.log(JSON.stringify(withAsset.rows, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
