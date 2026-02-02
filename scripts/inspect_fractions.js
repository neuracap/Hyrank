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

        // Fetch questions appearing to have fractions
        const res = await client.query(`
            SELECT source_question_no, question_number_int, body_json 
            FROM question_version 
            WHERE paper_session_id = $1 
            AND (
                body_json->>'text' LIKE '%frac%' OR
                body_json->>'text' LIKE '%/%'
            )
            ORDER BY question_number_int ASC
            LIMIT 20
        `, [sessionId]);

        console.log(`Found ${res.rows.length} potential fractions.`);

        res.rows.forEach(q => {
            const t = q.body_json.text || '';
            // Filter a bit more to avoid noise (like url paths)
            if (t.includes('\\frac') || t.match(/\d+\/\d+/)) {
                console.log(`\n--- Q.${q.question_number_int} ---`);
                console.log(t.substring(0, 200));
            }
        });

    } finally {
        client.release();
        pool.end();
    }
}

run();
