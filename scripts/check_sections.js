const { Pool } = require('pg');
const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkSections() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    const hinSessionId = '5a351865-69db-4879-bbeb-78f363edacf8';
    const client = await pool.connect();

    const engSecs = await client.query(`SELECT DISTINCT exam_section_id FROM question_version WHERE paper_session_id = '${engSessionId}' ORDER BY exam_section_id`);
    const hinSecs = await client.query(`SELECT DISTINCT exam_section_id FROM question_version WHERE paper_session_id = '${hinSessionId}' ORDER BY exam_section_id`);

    console.log("Eng Sections:", engSecs.rows.map(r => r.exam_section_id));
    console.log("Hin Sections:", hinSecs.rows.map(r => r.exam_section_id));

    client.release();
    await pool.end();
}
checkSections();
