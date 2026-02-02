const { Pool } = require('pg');
const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkText() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    const client = await pool.connect();
    // Get a question that definitely has math or tricky chars
    // Look for questions with backslashes or dollar signs
    const res = await client.query(`
        SELECT question_text 
        FROM question_version 
        WHERE paper_session_id = '${engSessionId}' 
          AND (question_text LIKE '%\\%' OR question_text LIKE '%$%')
        LIMIT 3
    `);

    console.log("Samples:");
    res.rows.forEach((r, i) => {
        console.log(`--- Sample ${i + 1} ---`);
        console.log(r.question_text);
    });

    client.release();
    await pool.end();
}
checkText();
