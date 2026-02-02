const { Pool } = require('pg');

const pool = new Pool({
    user: 'yoloprep_app',
    host: 'localhost',
    database: 'yolodb',
    password: 'Farishta123',
    port: 5433,
});

async function linkFinal() {
    const engSessionId = '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';
    const hinSessionId = '5a351865-69db-4879-bbeb-78f363edacf8';

    try {
        const client = await pool.connect();
        console.log('Connected.');

        // 1. Get Questions (Confirmed working logic)
        // Join to get Section Name
        let engQs = await client.query(`
            SELECT q.question_id, q.version_no, q.language, q.source_question_no, s.name as section_name 
            FROM question_version q
            JOIN exam_section s ON q.exam_section_id = s.section_id
            WHERE q.paper_session_id = '${engSessionId}'
        `);
        console.log(`Eng Qs: ${engQs.rows.length}`);
        console.log("Eng Section Sample:", engQs.rows.slice(0, 3).map(r => `[${r.section_name}]`));

        let hinQs = await client.query(`
            SELECT q.question_id, q.version_no, q.language, q.source_question_no, s.name as section_name 
            FROM question_version q
            JOIN exam_section s ON q.exam_section_id = s.section_id
            WHERE q.paper_session_id = '${hinSessionId}'
        `);
        console.log(`Hin Qs: ${hinQs.rows.length}`);
        console.log("Hin Section Sample:", hinQs.rows.slice(0, 3).map(r => `[${r.section_name}]`));

        // Create Hash Map for Sections
        const secMap = {};
        const engSecs = [...new Set(engQs.rows.map(r => r.section_name))].sort();
        const hinSecs = [...new Set(hinQs.rows.map(r => r.section_name))].sort();

        engSecs.forEach((es, i) => {
            if (hinSecs[i]) secMap[es] = hinSecs[i];
        });

        // EXPLICIT OVERRIDE for the known issue
        // If 'Quantitative Aptitude' is missing in Hindi, map it to 'General Awareness'
        if (engSecs.includes('Quantitative Aptitude') && !hinSecs.includes('Quantitative Aptitude')) {
            secMap['Quantitative Aptitude'] = 'General Awareness';
        }

        console.log("Section Map:", secMap);

        // Sort match order: Process General Awareness BEFORE Quantitative Aptitude
        engQs.rows.sort((a, b) => a.section_name.localeCompare(b.section_name));

        // 2. Link
        let linkedCount = 0;
        let failLogCount = 0;
        const usedHinIds = new Set();

        for (const engQ of engQs.rows) {
            const cleanEngNo = engQ.source_question_no ? engQ.source_question_no.replace(/[^0-9]/g, '') : 'N/A';
            const targetSecName = secMap[engQ.section_name];

            const partner = hinQs.rows.find(hq => {
                const hqNo = hq.source_question_no ? hq.source_question_no.replace(/[^0-9]/g, '') : 'N/A';
                return hqNo === cleanEngNo &&
                    hq.section_name === targetSecName &&
                    !usedHinIds.has(hq.question_id);
            });

            if (!partner) {
                if (failLogCount < 5) {
                    console.log(`Failed match for: Q.${cleanEngNo} [${engQ.section_name}] -> Target [${targetSecName}]`);
                    failLogCount++;
                }
            } else {
                usedHinIds.add(partner.question_id);
                const qE = engQ.question_id;
                const qH = partner.question_id;

                // Check existence (Hardcoded)
                // Note: Use string literal for UUIDs
                const exists = await client.query(`
                SELECT 1 FROM question_links 
                WHERE english_question_id = '${qE}' AND hindi_question_id = '${qH}'
            `);

                if (exists.rows.length === 0) {
                    // Insert (Hardcoded)
                    await client.query(`
                    INSERT INTO question_links (
                        paper_session_id_english, paper_session_id_hindi,
                        english_question_id, english_version_no, english_language,
                        hindi_question_id, hindi_version_no, hindi_language,
                        similarity_score, updated_score, status, created_at
                    ) VALUES (
                        '${engSessionId}', '${hinSessionId}',
                        '${qE}', ${engQ.version_no}, '${engQ.language}',
                        '${qH}', ${partner.version_no}, '${partner.language}',
                        0, 0, 'PENDING', NOW()
                    )
                 `);
                    linkedCount++;
                }
            }
        }
        console.log(`Linked ${linkedCount} pairs.`);

        client.release();
    } catch (e) {
        console.error("CRASH:", e);
    } finally {
        await pool.end();
    }
}
linkFinal();
