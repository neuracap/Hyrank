require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log("Finding a session with FLAGGED questions...");
    const res = await pool.query(`
        SELECT paper_session_id_english, count(*) as c
        FROM question_links 
        WHERE status = 'FLAGGED' AND paper_session_id_english IS NOT NULL
        GROUP BY paper_session_id_english
        ORDER BY c DESC
        LIMIT 1
    `);

    if (res.rows.length === 0) {
        console.log("No sessions with flagged questions found.");
        return await pool.end();
    }

    const sessionId = res.rows[0].paper_session_id_english;
    console.log("Found session:", sessionId, "with", res.rows[0].c, "flagged questions");

    // Get a question ID from this session (any question)
    const qRes = await pool.query(`
        SELECT english_question_id 
        FROM question_links 
        WHERE paper_session_id_english = $1
        LIMIT 1
    `, [sessionId]);

    console.log("Sample Question ID from this session you can search for:", qRes.rows[0]?.english_question_id);

    await pool.end();
}

run().catch(console.error);
