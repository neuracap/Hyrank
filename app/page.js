import db from '@/lib/db';
import Dashboard from '@/components/Dashboard';

export const dynamic = 'force-dynamic';

async function fetchData(testId, page = 1, limit = 200) {
    const offset = (page - 1) * limit;
    const client = await db.connect();

    try {
        // 1. Fetch Paper Sessions for Dropdown
        const testsRes = await client.query(`
            SELECT paper_session_id, session_label, paper_date 
            FROM paper_session 
            ORDER BY paper_date DESC
        `);
        const tests = testsRes.rows;

        // Default to first test if no testId provided
        const computedTestId = testId || (tests.length > 0 ? tests[0].paper_session_id : null);

        let questions = [];
        let total = 0;

        if (computedTestId) {
            // 2. Fetch Questions for the Test
            const questionsRes = await client.query(`
                SELECT 
                    qv.question_id as id, 
                    qv.version_no,
                    qv.difficulty,
                    qv.language,
                    qv.meta_json->>'canonical_code' as exam,
                    qv.body_json->>'text' as question_text,
                    qv.has_image as has_figure,
                    qv.source_question_no,
                    qv.meta_json,
                    es.code as section_code
                FROM question_version qv
                LEFT JOIN exam_section es ON qv.exam_section_id = es.section_id
                WHERE qv.paper_session_id = $1
                ORDER BY 
                    qv.exam_section_id ASC NULLS LAST,
                    CAST(SUBSTRING(qv.source_question_no FROM '[0-9]+') AS INTEGER) ASC NULLS LAST,
                    qv.created_at ASC 
                LIMIT $2 OFFSET $3
            `, [computedTestId, limit, offset]);

            questions = questionsRes.rows.map(q => ({
                id: q.id,
                version_no: q.version_no,
                q_no: q.source_question_no ? q.source_question_no : q.id.substring(0, 8),
                source_q_no: q.source_question_no,
                exam: q.exam || 'Unknown Exam',
                language: q.language,
                question_text: q.question_text || '',
                difficulty: q.difficulty || '',
                // Prefer linked section code (e.g. REASONING), fallback to legacy name
                subject: q.section_code || (q.meta_json ? q.meta_json.section_name : '') || 'General',
                has_figure: q.has_figure,
                figure_path: null,
                options: []
            }));

            // 3. Fetch Options (Fetch all languages for these IDs, filter in memory)
            const questionIds = questions.map(q => q.id);
            if (questionIds.length > 0) {
                const optionsRes = await client.query(`
                    SELECT 
                        question_id,
                        language,
                        option_key as opt_label,
                        option_json->>'text' as opt_text
                    FROM question_option
                    WHERE question_id = ANY($1)
                    ORDER BY option_key ASC
                `, [questionIds]);

                const allOptions = optionsRes.rows;
                questions.forEach(q => {
                    // CRITICAL: Filter options to match the question's language
                    // If question is HI, show only HI options.
                    q.options = allOptions.filter(o => o.question_id === q.id && o.language === q.language);
                });
            }

            // 4. Count
            const countRes = await client.query(`SELECT COUNT(*) as c FROM question_version WHERE paper_session_id = $1`, [computedTestId]);
            total = parseInt(countRes.rows[0].c, 10);
        }

        // 5. Fetch Valid Exam Sections for Dropdown
        let sections = [];
        if (computedTestId) {
            const paperRes = await client.query('SELECT exam_id FROM paper_session WHERE paper_session_id = $1', [computedTestId]);
            if (paperRes.rows.length > 0) {
                const examId = paperRes.rows[0].exam_id;
                const sectionsRes = await client.query('SELECT section_id, code, name FROM exam_section WHERE exam_id = $1 ORDER BY sort_order ASC', [examId]);
                sections = sectionsRes.rows;
            }
        }

        // 6. Fetch Document Info (PDF Path & MMD ID/Notes)
        let docInfo = {};
        if (computedTestId) {
            const docQuery = `
                SELECT j.source_pdf_path, j.notes, d.file_path as mmd_path
                FROM paper_session ps 
                JOIN raw_mmd_doc d ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
                JOIN import_job j ON d.import_job_id = j.import_job_id
                WHERE ps.paper_session_id = $1
            `;
            const docRes = await client.query(docQuery, [computedTestId]);
            docInfo = docRes.rows[0] || {};
        }

        return { questions, total, tests, selectedTestId: computedTestId, sections, docInfo };

    } catch (e) {
        console.error("Error fetching data:", e);
        return { questions: [], total: 0, tests: [], selectedTestId: null, sections: [] };
    } finally {
        client.release();
    }
}

export default async function Home({ searchParams }) {
    const { testId } = await searchParams;
    const { questions, total, tests, selectedTestId, sections, docInfo } = await fetchData(testId);

    return (
        <Dashboard
            questions={questions}
            total={total}
            tests={tests}
            selectedTestId={selectedTestId}
            sections={sections}
            docInfo={docInfo}
        />
    );
}
