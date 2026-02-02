const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkAllRecent() {
    try {
        const client = await pool.connect();
        const res = await client.query(`
      SELECT asset_id, original_name, local_path, created_at 
      FROM asset 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

        console.log(`Checking ${res.rows.length} assets...`);

        for (const row of res.rows) {
            let exists = false;
            try {
                exists = fs.existsSync(row.local_path);
            } catch (e) {
                console.error(`Error checking path for ${row.asset_id}:`, e);
            }
            console.log(`[${row.created_at.toISOString()}] ${row.asset_id} (${row.original_name}) -> Exists: ${exists}`);
            if (!exists) {
                console.log(`   Path: ${row.local_path}`);
            }
        }

        client.release();
    } catch (err) {
        console.error('Error executing query', err);
    } finally {
        await pool.end();
    }
}

checkAllRecent();
