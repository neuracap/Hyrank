const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkRecentAssets() {
    try {
        const client = await pool.connect();
        const res = await client.query(`
      SELECT * 
      FROM asset 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
        fs.writeFileSync('recent_assets_dump.json', JSON.stringify(res.rows, null, 2));
        console.log("Dumped assets to recent_assets_dump.json");
        client.release();
    } catch (err) {
        console.error('Error executing query', err);
        fs.writeFileSync('recent_assets_error.txt', err.toString());
    } finally {
        await pool.end();
    }
}

checkRecentAssets();
