const { Pool } = require('pg');
const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkBody() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    const client = await pool.connect();

    // Fetch a few samples
    const res = await client.query(`
        SELECT q.source_question_no, q.body_json 
        FROM question_version q
        JOIN exam_section s ON q.exam_section_id = s.section_id
        WHERE q.paper_session_id = '${engSessionId}' 
          AND s.name = 'Quantitative Aptitude'
          AND (q.body_json->>'text' LIKE '%\\frac%' OR q.body_json->>'text' LIKE '%^%' OR q.body_json->>'text' LIKE '%\\sqrt%')
        LIMIT 1
    `);

    res.rows.forEach((r, i) => {
        console.log(`--- ${r.source_question_no} ---`);
        console.log(JSON.stringify(r.body_json, null, 2));
    });

    client.release();
    await pool.end();
}
checkBody();
