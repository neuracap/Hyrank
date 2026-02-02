const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function findHindiSession() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';

    try {
        const client = await pool.connect();

        // Get Eng Session Details
        const engRes = await client.query(`
        SELECT session_label, exam_id
        FROM paper_session 
        WHERE paper_session_id = $1
    `, [engSessionId]);

        if (engRes.rows.length === 0) {
            console.log("English session not found.");
            return;
        }

        const { session_label, exam_id } = engRes.rows[0];
        console.log(`English Session: ${session_label}`);

        // Try to guess Hindi Label
        // Pattern seems to be [Exam-Name-Language_Date_Time]
        // Example: SSC-CGL-Tier-1-Question-Paper-English_26.09.2024_04.00-PM-05.00-PM
        // Target:  SSC-CGL-Tier-1-Question-Paper-Hindi_26.09.2024_04.00-PM-05.00-PM

        const hindiLabel = session_label.replace('English', 'Hindi');
        console.log(`Looking for Hindi Session: ${hindiLabel}`);

        const hinRes = await client.query(`
        SELECT paper_session_id 
        FROM paper_session 
        WHERE session_label = $1 AND exam_id = $2
    `, [hindiLabel, exam_id]);

        if (hinRes.rows.length > 0) {
            console.log(`✅ Found Hindi Session ID: ${hinRes.rows[0].paper_session_id}`);
        } else {
            console.log("❌ Hindi Session NOT found matching that label.");

            // List potential candidates?
            console.log("Potential candidates:");
            const candidates = await client.query(`
            SELECT session_label 
            FROM paper_session 
            WHERE exam_id = $1 AND session_label LIKE '%Hindi%'
            LIMIT 5
        `, [exam_id]);
            candidates.rows.forEach(r => console.log(` - ${r.session_label}`));
        }

        client.release();
    } catch (err) { console.error(err); } finally { await pool.end(); }
}

findHindiSession();
