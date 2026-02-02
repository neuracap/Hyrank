const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkImportedAsset() {
    const target = '111baf90-c04f-4eb1-ac8a-5bbcbb977455-13.jpg';
    console.log(`Checking for imported asset: ${target}`);

    try {
        const client = await pool.connect();
        // Search by substring as local_path might contain it
        const res = await client.query(`
      SELECT asset_id, original_name, local_path 
      FROM asset 
      WHERE local_path LIKE '%' || $1 || '%' OR original_name = $1
    `, [target]);

        console.log(`Found ${res.rows.length} matches.`);

        for (const row of res.rows) {
            let exists = false;
            try {
                exists = fs.existsSync(row.local_path);
            } catch (e) { }
            console.log(`[${row.asset_id}] ${row.original_name}`);
            console.log(`   Path: ${row.local_path}`);
            console.log(`   Exists: ${exists}`);
        }

        client.release();
    } catch (err) {
        console.error('Error executing query', err);
    } finally {
        await pool.end();
    }
}

checkImportedAsset();
