const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function debugLinks() {
    const sessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    console.log(`Debugging links for session: ${sessionId}`);

    try {
        const client = await pool.connect();

        // 1. Verify Session Exists
        const sessionRes = await client.query('SELECT paper_session_id, session_label FROM paper_session WHERE paper_session_id = $1', [sessionId]);
        if (sessionRes.rows.length === 0) {
            console.log("❌ CRITICAL: Session ID not found in paper_session table!");
        } else {
            console.log(`✅ Session Found: ${sessionRes.rows[0].session_label}`);
        }

        // 2. Count Links (Raw)
        const linksRes = await client.query('SELECT COUNT(*) FROM question_links WHERE paper_session_id_english = $1', [sessionId]);
        console.log(`\nRaw Link Count in question_links: ${linksRes.rows[0].count}`);

        // 3. Count Questions (Raw)
        const qRes = await client.query('SELECT COUNT(*) FROM question_version WHERE paper_session_id = $1', [sessionId]);
        console.log(`Raw Question Count in question_version: ${qRes.rows[0].count}`);

        // 4. Debug Join Failure? (Check one link)
        if (parseInt(linksRes.rows[0].count) > 0) {
            const joinCheck = await client.query(`
            SELECT ql.id, ql.english_question_id, ql.hindi_question_id
            FROM question_links ql
            LEFT JOIN question_version qe ON ql.english_question_id = qe.question_id
            LEFT JOIN question_version qh ON ql.hindi_question_id = qh.question_id
            WHERE ql.paper_session_id_english = $1
            LIMIT 1
        `, [sessionId]);
            console.log("\nSample Link Join Check:", joinCheck.rows[0]);
        }

        client.release();
    } catch (err) {
        console.error('Error executing query', err);
    } finally {
        await pool.end();
    }
}

debugLinks();
