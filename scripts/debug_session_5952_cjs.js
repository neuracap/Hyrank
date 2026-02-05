
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const paperSessionId = '59527c77-afe9-48f7-80ed-b317f3150253'; // From user screenshot

    try {
        console.log(`--- Debugging Session: ${paperSessionId} ---`);

        // 1. Check Paper Session
        console.log("1. Checking Paper Session...");
        const sessionRes = await pool.query(`SELECT paper_session_id, language FROM paper_session WHERE paper_session_id = $1`, [paperSessionId]);
        if (sessionRes.rows.length === 0) {
            console.log("❌ CRITICAL: Session ID NOT FOUND in paper_session table.");
            return;
        }
        const session = sessionRes.rows[0];
        console.log(`   ✅ Found Session. Language: ${session.language}`);

        // 2. Check Exam Sections
        console.log("2. Checking Exam Sections...");
        const sectionRes = await pool.query(`SELECT section_id, name, paper_session_id FROM exam_section WHERE paper_session_id = $1`, [paperSessionId]);
        console.log(`   Found ${sectionRes.rows.length} sections linked to this session.`);
        if (sectionRes.rows.length === 0) console.log("   ❌ WARNING: No sections found. Query expects sections.");

        // 3. Check Questions via Sections (The CTE logic)
        console.log("3. Checking Questions linked to these sections...");
        const qRes = await pool.query(`
            SELECT count(*) as count 
            FROM exam_section s
            JOIN question_version qe ON s.section_id = qe.exam_section_id
            WHERE qe.paper_session_id = $1
        `, [paperSessionId]);
        console.log(`   Found ${qRes.rows[0].count} question versions via JOIN.`);

        // 4. Run the Full Query (Simulated)
        console.log("4. Running Full Page Query...");
        const query = `
            WITH RankedQuestions AS (
                SELECT 
                    qe.question_id,
                    qe.version_no,
                    qe.language,
                    qe.source_question_no,
                    s.section_id,
                    ROW_NUMBER() OVER (PARTITION BY qe.question_id ORDER BY qe.version_no DESC) as rn
                FROM exam_section s
                JOIN question_version qe ON s.section_id = qe.exam_section_id
                WHERE qe.paper_session_id = $1
            )
            SELECT 
                qe.question_id,
                ql.id as link_id
            FROM RankedQuestions qe
            LEFT JOIN question_links ql ON (
                ql.english_question_id = qe.question_id AND 
                ql.english_version_no = qe.version_no
            )
            WHERE qe.rn = 1
            LIMIT 5;
        `;
        const fullRes = await pool.query(query, [paperSessionId]);
        console.log(`   Full Query returned ${fullRes.rows.length} rows.`);
        if (fullRes.rows.length > 0) console.log("   Sample:", fullRes.rows[0]);

    } catch (e) {
        console.error("❌ ERROR:", e);
    } finally {
        await pool.end();
    }
}

run();
