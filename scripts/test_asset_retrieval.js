const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function testAssetRetrieval() {
    const targetName = '47716a2b-52a6-4888-a30b-eb530a65c917.png';
    console.log(`Testing retrieval for name: ${targetName}`);

    try {
        const client = await pool.connect();

        // Mimic the API query
        const res = await client.query(`
        SELECT local_path, mime_type 
        FROM asset 
        WHERE local_path LIKE '%' || $1 || '%' OR original_name = $1
        LIMIT 1
    `, [targetName]);

        console.log(`Query returned ${res.rows.length} rows.`);

        if (res.rows.length > 0) {
            const row = res.rows[0];
            console.log('Row found:', row);

            const exists = fs.existsSync(row.local_path);
            console.log(`File exists on disk? ${exists}`);

            if (!exists) {
                console.log('WARNING: File path in DB does not exist on disk.');
            } else {
                // Try reading a bit to ensure permissions
                try {
                    const stats = fs.statSync(row.local_path);
                    console.log(`File stats: size=${stats.size}`);
                } catch (e) {
                    console.error("Error reading file stats:", e);
                }
            }
        } else {
            console.log('Error: API query did not find the asset.');
        }

        client.release();
    } catch (err) {
        console.error('Error executing test', err);
    } finally {
        await pool.end();
    }
}

testAssetRetrieval();
