const { Pool } = require('pg');
const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function printSecs() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    const hinSessionId = '5a351865-69db-4879-bbeb-78f363edacf8';
    const client = await pool.connect();

    // Get raw rows
    const engQs = await client.query(`SELECT s.name FROM question_version q JOIN exam_section s ON q.exam_section_id = s.section_id WHERE q.paper_session_id = '${engSessionId}'`);
    const hinQs = await client.query(`SELECT s.name FROM question_version q JOIN exam_section s ON q.exam_section_id = s.section_id WHERE q.paper_session_id = '${hinSessionId}'`);

    const engSecs = [...new Set(engQs.rows.map(r => r.name))].sort();
    const hinSecs = [...new Set(hinQs.rows.map(r => r.name))].sort();

    console.log(`ENG (${engSecs.length}):`);
    engSecs.forEach((s, i) => console.log(`${i}: ${s}`));

    console.log(`HIN (${hinSecs.length}):`);
    hinSecs.forEach((s, i) => console.log(`${i}: ${s}`));

    // Check counts
    const engCounts = {};
    engQs.rows.forEach(r => { engCounts[r.name] = (engCounts[r.name] || 0) + 1; });
    console.log("Eng Counts:", engCounts);

    const hinCounts = {};
    hinQs.rows.forEach(r => { hinCounts[r.name] = (hinCounts[r.name] || 0) + 1; });
    console.log("Hin Counts:", hinCounts);

    client.release();
    await pool.end();
}
printSecs();
