const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function testApiValidation() {
    try {
        console.log('Testing the validation logic for PRE_PUBLISH_READY...');

        // 1. Find a paper_session to test on
        const psRes = await pool.query(`
            SELECT ps.paper_session_id, ps.session_label, e.num_questions 
            FROM paper_session ps
            JOIN exam e ON ps.exam_id = e.exam_id
            WHERE e.num_questions IS NOT NULL
            LIMIT 1
        `);

        if (psRes.rows.length === 0) {
            console.log('No eligible paper_sessions found for testing.');
            return;
        }

        const paper = psRes.rows[0];
        console.log(`\nTesting on Paper: ${paper.session_label}`);
        console.log(`Exam requires: ${paper.num_questions} questions`);

        // 2. See how many questions it currently has
        const countRes = await pool.query(`
            SELECT COUNT(*) FROM question_version WHERE paper_session_id = $1
        `, [paper.paper_session_id]);

        const actualCount = parseInt(countRes.rows[0].count, 10);
        console.log(`Actual questions linked to paper: ${actualCount}`);

        console.log('--- Simulating API call ---');
        if (actualCount !== paper.num_questions) {
            console.log(`❌ API would BLOCK this transition. Error: Validation Failed - This exam requires exactly ${paper.num_questions} questions, but this paper currently has ${actualCount}.`)
        } else {
            console.log(`✅ API would ALLOW this transition!`)
        }

    } catch (e) {
        console.error('Test error:', e);
    } finally {
        await pool.end();
    }
}

testApiValidation();
