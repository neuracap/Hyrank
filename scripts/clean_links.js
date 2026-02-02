const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function clearLinks() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    const client = await pool.connect();
    const res = await client.query(`DELETE FROM question_links WHERE paper_session_id_english = '${engSessionId}'`);
    console.log(`Deleted ${res.rowCount} existing links.`);
    client.release();
    await pool.end();
}
clearLinks();
