const { Pool } = require('pg');
const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function compare() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    const hinSessionId = '5a351865-69db-4879-bbeb-78f363edacf8';
    const client = await pool.connect();

    const engSecs = await client.query(`SELECT DISTINCT exam_section_id FROM question_version WHERE paper_session_id = '${engSessionId}' ORDER BY exam_section_id`);
    const hinSecs = await client.query(`SELECT DISTINCT exam_section_id FROM question_version WHERE paper_session_id = '${hinSessionId}' ORDER BY exam_section_id`);

    console.log("Eng IDs:", engSecs.rows.map(r => r.exam_section_id));
    console.log("Hin IDs:", hinSecs.rows.map(r => r.exam_section_id));

    // Also verify counts per section
    for (const row of engSecs.rows) {
        const id = row.exam_section_id;
        const c = await client.query(`SELECT count(*) FROM question_version WHERE paper_session_id = '${engSessionId}' AND exam_section_id = '${id}'`);
        const nameRes = await client.query(`SELECT name, code FROM exam_section WHERE exam_section_id = '${id}'`);
        console.log(`Eng Sec [${id}] "${nameRes.rows[0]?.name}" Count: ${c.rows[0].count}`);
    }

    for (const row of hinSecs.rows) {
        const id = row.exam_section_id;
        const c = await client.query(`SELECT count(*) FROM question_version WHERE paper_session_id = '${hinSessionId}' AND exam_section_id = '${id}'`);
        const nameRes = await client.query(`SELECT name, code FROM exam_section WHERE exam_section_id = '${id}'`);
        console.log(`Hin Sec [${id}] "${nameRes.rows[0]?.name}" Count: ${c.rows[0].count}`);
    }

    client.release();
    await pool.end();
}
compare();
