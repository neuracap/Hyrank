const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkAssetLink() {
    const assetId = '47716a2b-52a6-4888-a30b-eb530a65c917';
    try {
        const client = await pool.connect();

        console.log("Checking link for asset:", assetId);

        const res = await client.query(`
      SELECT 
        qam.question_id, 
        qam.version_no,
        qv.body_json,
        qv.has_image
      FROM question_asset_map qam
      JOIN question_version qv ON qam.question_id = qv.question_id AND qam.version_no = qv.version_no
      WHERE qam.asset_id = $1
    `, [assetId]);

        console.log(JSON.stringify(res.rows, null, 2));

        client.release();
    } catch (err) {
        console.error('Error executing query', err);
    } finally {
        await pool.end();
    }
}

checkAssetLink();
