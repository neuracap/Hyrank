const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function run() {
    const client = await pool.connect();
    try {
        const sessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9'; // User's session

        // Fetch first 20 questions to find the ones matching Q.14/15
        const res = await client.query(`
            SELECT source_question_no, question_number_int, body_json 
            FROM question_version 
            WHERE paper_session_id = $1 
            ORDER BY question_number_int ASC
            LIMIT 50
        `, [sessionId]);

        console.log(`Fetched ${res.rows.length} questions.`);

        res.rows.forEach(q => {
            const t = q.body_json.text || '';
            if (t.includes('}=') || t.includes('}^{')) {
                console.log(`\n--- Q.${q.question_number_int} (${q.source_question_no}) ---`);
                console.log(t);
                console.log('-----------------------------------');
            }
        });

    } finally {
        client.release();
        pool.end();
    }
}

run();
