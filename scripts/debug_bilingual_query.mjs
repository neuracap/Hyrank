
import db from '../lib/db.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
    console.log("DB URL present:", !!process.env.DATABASE_URL);
    const client = await db.connect();
    const paperSessionId = '619d2979-519d-49fe-8a3c-13bcd5a7caa2';
    try {
        console.log("Checking session...");
        const sessionLangRes = await client.query(`SELECT language FROM paper_session WHERE paper_session_id = $1`, [paperSessionId]);

        if (sessionLangRes.rows.length === 0) { console.log("Session not found"); return; }

        const sessionLanguage = sessionLangRes.rows[0].language;
        const isEnglishSession = sessionLanguage === 'EN';
        console.log(`Session Language: ${sessionLanguage}, matches EN: ${isEnglishSession}`);

        const query = `
            WITH RankedQuestions AS (
                SELECT 
                    qe.question_id,
                    qe.version_no,
                    qe.language,
                    qe.body_json,
                    qe.has_image,
                    qe.source_question_no,
                    qe.exam_section_id,
                    qe.difficulty,
                    s.section_id,
                    s.sort_order,
                    ROW_NUMBER() OVER (PARTITION BY qe.question_id ORDER BY qe.version_no DESC) as rn
                FROM exam_section s
                JOIN question_version qe ON s.section_id = qe.exam_section_id
                WHERE s.paper_session_id = $1 AND qe.language = '${isEnglishSession ? 'EN' : 'HI'}'
            )
            SELECT 
                ql.id as link_id,
                qe.question_id as eng_id
            FROM RankedQuestions qe
            LEFT JOIN question_links ql ON (
                ql.english_question_id = qe.question_id AND 
                ql.english_version_no = qe.version_no
            )
            WHERE qe.rn = 1
            LIMIT 5;
        `;

        console.log("Running Query...");
        const res = await client.query(query, [paperSessionId]);
        console.log("Rows returned:", res.rows.length);
        if (res.rows.length > 0) console.log(res.rows[0]);

    } catch (e) {
        console.error("Error:", e);
    } finally {
        client.release();
        // Force exit because pool keeps connection open
        process.exit(0);
    }
}

run();
