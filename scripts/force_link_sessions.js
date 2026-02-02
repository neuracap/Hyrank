const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function forceLink() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    const hinSessionId = '5a351865-69db-4879-bbeeb-78f363edacf8';

    try {
        const client = await pool.connect();

        console.log(`Linking:\n English: ${engSessionId}\n Hindi:   ${hinSessionId}`);

        // 3. Link Questions
        // Fetch all Eng Questions
        console.log("Fetching English questions...");
        const engQs = await client.query('SELECT question_id, version_no, language, source_question_no FROM question_version WHERE paper_session_id = $1', [engSessionId]);

        // Fetch all Hindi Questions
        console.log("Fetching Hindi questions...");
        const hinQs = await client.query('SELECT question_id, version_no, language, source_question_no FROM question_version WHERE paper_session_id = $1', [hinSessionId]);

        console.log(`Eng Qs: ${engQs.rows.length}, Hin Qs: ${hinQs.rows.length}`);

        // 4. Match and Insert
        let linkedCount = 0;
        for (const engQ of engQs.rows) {
            // Find matching Hindi Q by source_question_no (e.g. "Q.1")
            const cleanEngNo = engQ.source_question_no.replace(/[^0-9]/g, '');
            const partner = hinQs.rows.find(hq => hq.source_question_no.replace(/[^0-9]/g, '') === cleanEngNo);

            if (partner) {
                // Check if link exists
                const exists = await client.query(`
                SELECT 1 FROM question_links 
                WHERE english_question_id = $1 AND hindi_question_id = $2
            `, [engQ.question_id, partner.question_id]);

                if (exists.rows.length === 0) {
                    console.log('Inserting match:', {
                        engS: engSessionId,
                        hinS: hinSessionId,
                        engQ: engQ.question_id,
                        hinQ: partner.question_id
                    });

                    await client.query(`
                    INSERT INTO question_links (
                        paper_session_id_english, paper_session_id_hindi,
                        english_question_id, english_version_no, english_language,
                        hindi_question_id, hindi_version_no, hindi_language,
                        similarity_score, updated_score, status, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 'PENDING', NOW())
                `, [
                        engSessionId, hinSessionId,
                        engQ.question_id, engQ.version_no, engQ.language,
                        partner.question_id, partner.version_no, partner.language
                    ]);
                    linkedCount++;
                }
            }
        }
        console.log(`Successfully linked ${linkedCount} pairs.`);
        client.release();
    } catch (e) { console.error(e); } finally { await pool.end(); }
}

forceLink();
