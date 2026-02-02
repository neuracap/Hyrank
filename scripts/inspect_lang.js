const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function inspect() {
    try {
        const client = await pool.connect();

        console.log('--- Distinct Languages in question_version ---');
        const resLang = await client.query('SELECT DISTINCT language FROM question_version');
        console.log(resLang.rows);

        console.log('\n--- Paper Sessions with "Hindi" in label ---');
        const resPaper = await client.query("SELECT paper_session_id, session_label FROM paper_session WHERE session_label ILIKE '%Hindi%' LIMIT 5");
        console.log(resPaper.rows);

        if (resPaper.rows.length > 0) {
            const testId = resPaper.rows[0].paper_session_id;
            console.log(`\n--- Questions for Paper ${testId} (Label: ${resPaper.rows[0].session_label}) ---`);
            const resQ = await client.query('SELECT language, count(*) FROM question_version WHERE paper_session_id = $1 GROUP BY language', [testId]);
            console.log(resQ.rows);
        }

        client.release();
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
