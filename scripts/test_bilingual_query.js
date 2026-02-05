require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function testBilingualQuery() {
    const paperSessionId = '59527c77-afe9-48f7-80ed-b317f3150253';
    const client = await pool.connect();

    try {
        console.log('Testing Bilingual Query for session:', paperSessionId);

        // Test 1: Check session language
        const sessionLangRes = await client.query(`
            SELECT language FROM paper_session WHERE paper_session_id = $1
        `, [paperSessionId]);

        console.log('\n1. Session Language:', sessionLangRes.rows);

        if (sessionLangRes.rows.length === 0) {
            console.error('ERROR: Paper session not found!');
            return;
        }

        //Test 2: Main query
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
                WHERE qe.paper_session_id = $1
            )
            SELECT 
                ql.id as link_id,
                qe.question_id as eng_id,
                qe.version_no as eng_version,
                qe.source_question_no as eng_source_no,
                qh.question_id as hin_id,
                qh.version_no as hin_version,
                qh.source_question_no as hin_source_no
            FROM RankedQuestions qe
            INNER JOIN question_links ql ON (
                ql.english_question_id = qe.question_id AND 
                ql.english_version_no = qe.version_no
            )
            LEFT JOIN question_version qh ON (
                ql.hindi_question_id = qh.question_id AND 
                ql.hindi_version_no = qh.version_no AND 
                ql.hindi_language = qh.language
            )
            WHERE qe.rn = 1
            LIMIT 5;
        `;

        console.log('\n2. Executing main query...');
        const res = await client.query(query, [paperSessionId]);
        console.log(`Found ${res.rows.length} linked questions`);
        console.log('\nFirst few results:');
        res.rows.forEach((row, idx) => {
            console.log(`\n  [${idx}]:`);
            console.log(`    eng_id: ${row.eng_id}`);
            console.log(`    eng_source_no: ${row.eng_source_no}`);
            console.log(`    hin_id: ${row.hin_id}`);
            console.log(`    hin_source_no: ${row.hin_source_no}`);
            console.log(`    link_id: ${row.link_id}`);
        });

    } catch (e) {
        console.error('\nERROR:', e.message);
        console.error('Stack:', e.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

testBilingualQuery();
