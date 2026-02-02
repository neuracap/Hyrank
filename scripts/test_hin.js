const { Pool } = require('pg');
const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});
async function test() {
    const id = '5a351865-69db-4879-bbeeb-78f363edacf8';
    const client = await pool.connect();
    try {
        console.log(`Testing ID: ${id}`);
        const res = await client.query(`SELECT count(*) FROM question_version WHERE paper_session_id = '${id}'`);
        console.log(`Count: ${res.rows[0].count}`);
    } catch (e) { console.error(e); }
    client.release();
    await pool.end();
}
test();
