const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkSectionNames() {
    try {
        const client = await pool.connect();

        // Get distinct section names stored in meta_json
        const res = await client.query(`
        SELECT DISTINCT meta_json->>'section_name' as db_section_name
        FROM question_version
        LIMIT 20
    `);

        console.log("Values in DB (meta_json.section_name):");
        console.log(res.rows.map(r => r.db_section_name));

        client.release();
    } catch (err) { console.error(err); } finally { await pool.end(); }
}
checkSectionNames();
