const { Pool } = require('pg');
const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function inspect() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    const hinSessionId = '5a351865-69db-4879-bbeb-78f363edacf8';
    const client = await pool.connect();

    const engQs = await client.query(`SELECT source_question_no FROM question_version WHERE paper_session_id = '${engSessionId}' LIMIT 5`);
    const hinQs = await client.query(`SELECT source_question_no FROM question_version WHERE paper_session_id = '${hinSessionId}' LIMIT 5`);

    console.log("English samples:", engQs.rows.map(r => r.source_question_no));
    console.log("Hindi samples:", hinQs.rows.map(r => r.source_question_no));

    client.release();
    await pool.end();
}
inspect();
