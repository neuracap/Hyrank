const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkMissingFiles() {
    try {
        const client = await pool.connect();
        const res = await client.query(`
      SELECT asset_id, original_name, local_path, created_at 
      FROM asset 
      ORDER BY created_at DESC 
      LIMIT 50
    `);

        console.log(`Checking ${res.rows.length} assets...`);
        let missingCount = 0;

        for (const row of res.rows) {
            let exists = false;
            try {
                exists = fs.existsSync(row.local_path);
            } catch (e) { }

            if (!exists) {
                console.log(`[MISSING] ${row.created_at.toISOString()} - ${row.local_path}`);
                missingCount++;
            }
        }

        console.log(`Found ${missingCount} missing files out of ${res.rows.length}.`);

        client.release();
    } catch (err) {
        console.error('Error executing query', err);
    } finally {
        await pool.end();
    }
}

checkMissingFiles();
