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

        console.log("--- Tables ---");
        const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
        console.log(tables.rows.map(r => r.table_name));

        console.log("\n--- Asset Columns (if 'asset' exists) ---");
        const columns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'asset'
    `);
        console.log(columns.rows);

        client.release();
    } catch (err) {
        console.error('Error executing query', err);
    } finally {
        await pool.end();
    }
}

checkSchema();
