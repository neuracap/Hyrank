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
        console.log('Connected to DB');

        console.log(`Eng ID: ${engSessionId}`);
        console.log(`Hin ID: ${hinSessionId}`);

        // Direct Hardcoded Query Logic
        // Re-assign engQs using the hardcoded query, no new declaration needed
        let engQs = await client.query(`SELECT question_id, version_no, language, source_question_no FROM question_version WHERE paper_session_id = '${engSessionId}'`);
        console.log(`Eng Qs: ${engQs.rows.length}`);

        // Re-assign hinQs using the hardcoded query, no new declaration needed
        let hinQs = await client.query(`SELECT question_id, version_no, language, source_question_no FROM question_version WHERE paper_session_id = '${hinSessionId}'`);
        console.log(`Hin Qs: ${hinQs.rows.length}`);

        let linkedCount = 0;
        for (const engQ of engQs.rows) {
            const cleanEngNo = engQ.source_question_no.replace(/[^0-9]/g, '');
            const partner = hinQs.rows.find(hq => hq.source_question_no.replace(/[^0-9]/g, '') === cleanEngNo);

            if (partner) {
                try {
                    const exists = await client.query(`
                    SELECT 1 FROM question_links 
                    WHERE english_question_id = '${engQ.question_id}' AND hindi_question_id = '${partner.question_id}'
                `);

                    if (exists.rows.length === 0) {
                        // Use params for questions, but hardcode sessions
                        // Actually, param binding is broken for UUIDs entirely.
                        // We must hardcode ALL UUIDs.

                        const qEnglishId = engQ.question_id;
                        const qHindiId = partner.question_id;

                        // Sanity check UUIDs
                        if (!qEnglishId || !qHindiId) {
                            console.error("Missing question IDs", engQ, partner);
                            continue;
                        }

                        await client.query(`
                        INSERT INTO question_links (
                            paper_session_id_english, paper_session_id_hindi,
                            english_question_id, english_version_no, english_language,
                            hindi_question_id, hindi_version_no, hindi_language,
                            similarity_score, updated_score, status, created_at
                        ) VALUES (
                            '${engSessionId}', '${hinSessionId}',
                            '${qEnglishId}', ${engQ.version_no}, '${engQ.language}',
                            '${qHindiId}', ${partner.version_no}, '${partner.language}',
                            0, 0, 'PENDING', NOW()
                        )
                    `);
                        linkedCount++;
                    }

                } catch (e) {
                    console.error("Failed to insert link:", e);
                    console.log("Params:", engSessionId, hinSessionId, engQ.question_id, partner.question_id);
                }
            }
        }
        console.log(`Successfully linked ${linkedCount} pairs.`);
        client.release();
    } catch (e) { console.error(e); } finally { await pool.end(); }
}

forceLink();
