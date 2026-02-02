const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkImageVersions() {
    try {
        const client = await pool.connect();

        // Get recent versions with images
        const res = await client.query(`
      SELECT question_id, version_no, language, body_json, created_at 
      FROM question_version 
      WHERE has_image = true
      ORDER BY created_at DESC 
      LIMIT 3
    `);
        fs.writeFileSync('recent_image_versions_dump.json', JSON.stringify(res.rows, null, 2));

        client.release();
    } catch (err) {
        console.error('Error executing query', err);
        fs.writeFileSync('recent_image_versions_error.txt', err.toString());
    } finally {
        await pool.end();
    }
}

checkImageVersions();
