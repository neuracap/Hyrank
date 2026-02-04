import BilingualList from '@/components/BilingualList';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

async function fetchLinkedQuestions(paperSessionId, page = 1, limit = 100, sortBy = 'eng') {
    const offset = (page - 1) * limit;
    const client = await db.connect();
    try {
        // First, determine if this session is English or Hindi
        const sessionLangRes = await client.query(`
            SELECT language FROM paper_session WHERE paper_session_id = $1
        `, [paperSessionId]);

        if (sessionLangRes.rows.length === 0) {
            console.error('Paper session not found:', paperSessionId);
            return { questions: [], total: 0, engDocInfo: {}, hinDocInfo: {} };
        }

        const sessionLanguage = sessionLangRes.rows[0].language;
        const isEnglishSession = sessionLanguage === 'EN';

        // Build query based on which language this session is
        const whereClause = isEnglishSession
            ? 'ql.paper_session_id_english = $1'
            : 'ql.paper_session_id_hindi = $1';

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
                WHERE s.paper_session_id = $1 -- Removed language constraint to ensure we get all questions
            )
            SELECT 
                ql.id as link_id,
                ql.similarity_score,
                ql.updated_score,
                ql.status,
                
                -- English Question (From Source or Link)
                qe.question_id as eng_id,
                qe.version_no as eng_version,
                qe.body_json->>'text' as eng_text,
                qe.has_image as eng_has_figure,
                qe.source_question_no as eng_source_no,
                qe.exam_section_id as eng_section_id,
                qe.difficulty as eng_difficulty,
                
                -- Hindi Question (Only if Linked)
                qh.question_id as hin_id,
                qh.version_no as hin_version,
                qh.body_json->>'text' as hin_text,
                qh.has_image as hin_has_figure,
                qh.source_question_no as hin_source_no,
                qh.exam_section_id as hin_section_id,
                
                ql.translated_debug
            FROM RankedQuestions qe
            LEFT JOIN question_links ql ON (
                ql.english_question_id = qe.question_id AND 
                ql.english_version_no = qe.version_no
            )
            LEFT JOIN question_version qh ON (
                ql.hindi_question_id = qh.question_id AND 
                ql.hindi_version_no = qh.version_no AND 
                ql.hindi_language = qh.language
            )
            LEFT JOIN exam_section s ON qe.exam_section_id = s.section_id
            LEFT JOIN exam_section sh ON qh.exam_section_id = sh.section_id
            WHERE qe.rn = 1 -- Get latest version of each question
            ORDER BY 
                 s.sort_order ASC NULLS LAST,
                 CAST(SUBSTRING(qe.source_question_no FROM '[0-9]+') AS INTEGER) ASC NULLS LAST,
                 ql.created_at ASC
            LIMIT $2 OFFSET $3;
        `;

        const res = await client.query(query, [paperSessionId, limit, offset]);
        const links = res.rows;

        // Fetch Count
        const countRes = await client.query(`
            SELECT COUNT(DISTINCT qe.question_id) as c
            FROM exam_section s
            JOIN question_version qe ON s.section_id = qe.exam_section_id
            WHERE s.paper_session_id = $1
        `, [paperSessionId]);
        const total = parseInt(countRes.rows[0].c, 10);



        // Fetch options for both
        const engIds = links.map(l => l.eng_id);
        const hinIds = links.map(l => l.hin_id);
        const allIds = [...new Set([...engIds, ...hinIds])];

        let allOptions = [];
        if (allIds.length > 0) {
            const optionsRes = await client.query(`
                SELECT 
                    question_id,
                    version_no,
                    language,
                    option_key as opt_label,
                    option_json->>'text' as opt_text
                FROM question_option
                WHERE question_id = ANY($1)
                ORDER BY option_key ASC
            `, [allIds]);
            allOptions = optionsRes.rows;
        }

        // Attach options
        const questions = links.map(link => ({
            ...link,
            eng_options: allOptions.filter(o => o.question_id === link.eng_id && o.version_no === link.eng_version && o.language === 'EN'),
            hin_options: allOptions.filter(o => o.question_id === link.hin_id && o.version_no === link.hin_version && o.language === 'HI')
        }));

        // Fetch Document Info based on session type
        const docQuery = `
            SELECT j.source_pdf_path, j.notes, d.file_path as mmd_path
            FROM paper_session ps 
            JOIN raw_mmd_doc d ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
            JOIN import_job j ON d.import_job_id = j.import_job_id
            WHERE ps.paper_session_id = $1
        `;

        let engDocInfo = {};
        let hinDocInfo = {};

        if (isEnglishSession) {
            // Current session is English
            const engDocRes = await client.query(docQuery, [paperSessionId]);
            engDocInfo = engDocRes.rows[0] || {};

            // Find Hindi session
            const hinLinkRes = await client.query(`
                SELECT paper_session_id_hindi 
                FROM question_links 
                WHERE paper_session_id_english = $1 
                LIMIT 1
            `, [paperSessionId]);

            if (hinLinkRes.rows.length > 0 && hinLinkRes.rows[0].paper_session_id_hindi) {
                const hinSessionId = hinLinkRes.rows[0].paper_session_id_hindi;
                const hinDocRes = await client.query(docQuery, [hinSessionId]);
                hinDocInfo = hinDocRes.rows[0] || {};
            }
        } else {
            // Current session is Hindi
            const hinDocRes = await client.query(docQuery, [paperSessionId]);
            hinDocInfo = hinDocRes.rows[0] || {};

            // Find English session
            const engLinkRes = await client.query(`
                SELECT paper_session_id_english 
                FROM question_links 
                WHERE paper_session_id_hindi = $1 
                LIMIT 1
            `, [paperSessionId]);

            if (engLinkRes.rows.length > 0 && engLinkRes.rows[0].paper_session_id_english) {
                const engSessionId = engLinkRes.rows[0].paper_session_id_english;
                const engDocRes = await client.query(docQuery, [engSessionId]);
                engDocInfo = engDocRes.rows[0] || {};
            }
        }

        return { questions, total, engDocInfo, hinDocInfo };

    } catch (e) {
        console.error("Error fetching linked questions:", e);
        return { questions: [], total: 0, engDocInfo: {}, hinDocInfo: {} };
    } finally {
        client.release();
    }
}

export default async function BilingualPage({ params, searchParams }) {
    const { id: paperSessionId } = await params;
    const { page, sort } = await searchParams;

    const currentPage = parseInt(page || '1', 10);
    const limit = 100;
    const sortBy = sort === 'hin' ? 'hin' : 'eng';

    const { questions, total, engDocInfo, hinDocInfo } = await fetchLinkedQuestions(paperSessionId, currentPage, limit, sortBy);
    const totalPages = Math.ceil(total / limit);

    return (
        <BilingualList
            initialQuestions={questions}
            total={total}
            currentPage={currentPage}
            totalPages={totalPages}
            paperSessionId={paperSessionId}
            engDocInfo={engDocInfo}
            hinDocInfo={hinDocInfo}
        />
    );
}
