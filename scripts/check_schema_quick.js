const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkSchema() {
    try {
        const client = await pool.connect();

        console.log('=== Paper Session Schema ===');
        const schemaRes = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'paper_session'
            ORDER BY ordinal_position
        `);
        console.log(JSON.stringify(schemaRes.rows, null, 2));

        client.release();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

checkSchema();
