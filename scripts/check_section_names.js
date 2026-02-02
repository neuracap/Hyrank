const { Pool } = require('pg');
const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});
async function names() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    const hinSessionId = '5a351865-69db-4879-bbeb-78f363edacf8';
    const client = await pool.connect();

    const eng = await client.query(`SELECT DISTINCT s.name FROM question_version q JOIN exam_section s ON q.exam_section_id = s.section_id WHERE q.paper_session_id = '${engSessionId}' ORDER BY s.name`);
    const hin = await client.query(`SELECT DISTINCT s.name FROM question_version q JOIN exam_section s ON q.exam_section_id = s.section_id WHERE q.paper_session_id = '${hinSessionId}' ORDER BY s.name`);

    // console.log("Eng Names:", eng.rows.map(r => r.name));
    console.log("Hin Names:", hin.rows.map(r => r.name));

    client.release();
    await pool.end();
}
names();
