const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function checkBilingualData() {
    const paperSessionId = 'd452daf4-a36a-45e5-8664-936e0befe92a';

    try {
        const client = await pool.connect();

        console.log('=== Checking Paper Session ===');
        const sessionRes = await client.query(`
            SELECT *
            FROM paper_session ps
            WHERE ps.paper_session_id = $1
        `, [paperSessionId]);
        console.log('Session Info:', JSON.stringify(sessionRes.rows, null, 2));

        if (sessionRes.rows.length === 0) {
            console.log('\n❌ NO SESSION FOUND for this ID!');
            client.release();
            await pool.end();
            return;
        }

        console.log('\n=== Checking Question Links (English Session) ===');
        const linksRes = await client.query(`
            SELECT 
                ql.id,
                ql.paper_session_id_english,
                ql.paper_session_id_hindi,
                ql.english_question_id,
                ql.hindi_question_id,
                ql.status
            FROM question_links ql
            WHERE ql.paper_session_id_english = $1
            LIMIT 5
        `, [paperSessionId]);
        console.log('Question Links (as English):', JSON.stringify(linksRes.rows, null, 2));
        console.log(`Total links found as English: ${linksRes.rowCount}`);

        console.log('\n=== Checking Question Links (Hindi Session) ===');
        const hinLinksRes = await client.query(`
            SELECT 
                ql.id,
                ql.paper_session_id_english,
                ql.paper_session_id_hindi,
                ql.english_question_id,
                ql.hindi_question_id,
                ql.status
            FROM question_links ql
            WHERE ql.paper_session_id_hindi = $1
            LIMIT 5
        `, [paperSessionId]);
        console.log('Question Links (as Hindi):', JSON.stringify(hinLinksRes.rows, null, 2));
        console.log(`Total links found as Hindi: ${hinLinksRes.rowCount}`);

        console.log('\n=== Count Total Question Links ===');
        const countRes = await client.query(`
            SELECT COUNT(*) as total
            FROM question_links ql
            WHERE ql.paper_session_id_english = $1 OR ql.paper_session_id_hindi = $1
        `, [paperSessionId]);
        console.log('Total links:', countRes.rows[0].total);

        console.log('\n=== Checking Questions in this Session ===');
        const questionsRes = await client.query(`
            SELECT question_id, language, source_question_no
            FROM question_version
            WHERE paper_session_id = $1
            LIMIT 5
        `, [paperSessionId]);
        console.log('Questions:', JSON.stringify(questionsRes.rows, null, 2));

        const questionCountRes = await client.query(`
            SELECT language, COUNT(*) as count
            FROM question_version
            WHERE paper_session_id = $1
            GROUP BY language
        `, [paperSessionId]);
        console.log('Question count by language:', JSON.stringify(questionCountRes.rows, null, 2));

        client.release();
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

checkBilingualData();
