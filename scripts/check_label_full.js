const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkLabel() {
    const sessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    try {
        const client = await pool.connect();
        const res = await client.query('SELECT session_label, exam_id FROM paper_session WHERE paper_session_id = $1', [sessionId]);
        console.log("FULL LABEL:", JSON.stringify(res.rows[0], null, 2));
        client.release();
    } catch (e) { console.error(e); } finally { await pool.end(); }
}
checkLabel();
