import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import VerifyUnlink from '@/components/VerifyUnlink';
import VerifyUnlinkFilters from '@/components/VerifyUnlinkFilters';

export const dynamic = 'force-dynamic';

// Reviewers assigned to verify-unlink work, mapped to their split slot
const VERIFY_REVIEWERS = {
    2: 0,  // user1@hyrank.com → slot 0
    3: 1,  // user2@hyrank.com → slot 1
};
const VERIFY_REVIEWER_COUNT = Object.keys(VERIFY_REVIEWERS).length;

async function fetchUnverifiedQuestions(page = 1, limit = 100, userSlot = null, examFilter = null, sectionFilter = null) {
    const offset = (page - 1) * limit;
    let client;

    try {
        client = await db.connect();

        // Paper sessions where 90%+ of linked questions are MANUALLY_CORRECTED
        const qualifiedSessionsQuery = `
            SELECT paper_session_id FROM (
                SELECT paper_session_id,
                       COUNT(*) AS total_links,
                       COUNT(*) FILTER (WHERE status = 'MANUALLY_CORRECTED') AS corrected_links
                FROM (
                    SELECT paper_session_id_english AS paper_session_id, status FROM question_links WHERE paper_session_id_english IS NOT NULL
                    UNION ALL
                    SELECT paper_session_id_hindi AS paper_session_id, status FROM question_links WHERE paper_session_id_hindi IS NOT NULL
                ) all_links
                GROUP BY paper_session_id
                HAVING COUNT(*) >= 50
                   AND COUNT(*) FILTER (WHERE status = 'MANUALLY_CORRECTED') >= 0.9 * COUNT(*)
            ) reviewed_sessions
        `;

        // Split filter: for reviewers, only show their portion
        const splitFilter = userSlot !== null
            ? `AND abs(hashtext(qv.question_id::text)) % ${VERIFY_REVIEWER_COUNT} = ${userSlot}`
            : '';

        // Build dynamic filters
        const params = [limit, offset];
        let paramIdx = 3;
        let examClause = '';
        let sectionClause = '';

        if (examFilter && examFilter !== 'ALL') {
            examClause = `AND e.name = $${paramIdx}`;
            params.push(examFilter);
            paramIdx++;
        }
        if (sectionFilter && sectionFilter !== 'ALL') {
            sectionClause = `AND qv.exam_section_id = $${paramIdx}`;
            params.push(sectionFilter);
            paramIdx++;
        }

        // Unverified questions from those sessions
        const questionsRes = await client.query(`
            WITH qualified_sessions AS (${qualifiedSessionsQuery})
            SELECT
                qv.question_id          AS id,
                qv.version_no,
                qv.language,
                qv.body_json->>'text'   AS question_text,
                qv.has_image            AS has_figure,
                qv.source_question_no,
                qv.difficulty,
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                e.name                  AS exam_name,
                j.source_pdf_path
            FROM question_version qv
            JOIN qualified_sessions qs ON qv.paper_session_id = qs.paper_session_id
            JOIN paper_session ps       ON qv.paper_session_id = ps.paper_session_id
            LEFT JOIN exam e            ON ps.exam_id = e.exam_id
            LEFT JOIN raw_mmd_doc d     ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
            LEFT JOIN import_job j      ON d.import_job_id = j.import_job_id
            WHERE (qv.is_verified = FALSE OR qv.is_verified IS NULL)
              AND qv.question_id NOT IN (
                  SELECT english_question_id FROM question_links
                  UNION
                  SELECT hindi_question_id FROM question_links WHERE hindi_question_id IS NOT NULL
              )
              ${examClause}
              ${sectionClause}
              ${splitFilter}
            ORDER BY e.name ASC NULLS LAST,
                     ps.session_label ASC NULLS LAST,
                     ps.paper_date DESC NULLS LAST,
                     CAST(SUBSTRING(qv.source_question_no FROM '[0-9]+') AS INTEGER) ASC NULLS LAST,
                     qv.question_id ASC
            LIMIT $1 OFFSET $2
        `, params);

        const questions = questionsRes.rows;

        // Total count (same filters minus limit/offset)
        const countParams = [];
        let countParamIdx = 1;
        let countExamClause = '';
        let countSectionClause = '';

        if (examFilter && examFilter !== 'ALL') {
            countExamClause = `AND e.name = $${countParamIdx}`;
            countParams.push(examFilter);
            countParamIdx++;
        }
        if (sectionFilter && sectionFilter !== 'ALL') {
            countSectionClause = `AND qv.exam_section_id = $${countParamIdx}`;
            countParams.push(sectionFilter);
            countParamIdx++;
        }

        const countRes = await client.query(`
            WITH qualified_sessions AS (${qualifiedSessionsQuery})
            SELECT COUNT(*) AS c
            FROM question_version qv
            JOIN qualified_sessions qs ON qv.paper_session_id = qs.paper_session_id
            LEFT JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
            LEFT JOIN exam e           ON ps.exam_id = e.exam_id
            WHERE (qv.is_verified = FALSE OR qv.is_verified IS NULL)
              AND qv.question_id NOT IN (
                  SELECT english_question_id FROM question_links
                  UNION
                  SELECT hindi_question_id FROM question_links WHERE hindi_question_id IS NOT NULL
              )
              ${countExamClause}
              ${countSectionClause}
              ${splitFilter}
        `, countParams);
        const total = parseInt(countRes.rows[0].c, 10);

        // Fetch options for all questions
        const allIds = questions.map(q => q.id);
        let allOptions = [];
        if (allIds.length > 0) {
            const optRes = await client.query(`
                SELECT
                    question_id,
                    version_no,
                    language,
                    option_key  AS opt_label,
                    option_json->>'text' AS opt_text
                FROM question_option
                WHERE question_id = ANY($1)
                ORDER BY option_key ASC
            `, [allIds]);
            allOptions = optRes.rows;
        }

        const enriched = questions.map(q => ({
            ...q,
            options: allOptions.filter(
                o => o.question_id === q.id && o.version_no === q.version_no && o.language === q.language
            )
        }));

        return { questions: enriched, total, totalPages: Math.ceil(total / limit) };

    } catch (e) {
        console.error('fetchUnverifiedQuestions error:', e);
        return { questions: [], total: 0, totalPages: 0 };
    } finally {
        client?.release();
    }
}

export default async function VerifyUnlinkPage({ searchParams }) {
    const user = await getCurrentUser();
    if (!user) redirect('/login');

    // Allow admin + designated reviewers
    const isAllowed = user.isAdmin || (user.id in VERIFY_REVIEWERS);
    if (!isAllowed) redirect('/login');

    // Admin sees all, reviewers see their split
    const userSlot = user.isAdmin ? null : VERIFY_REVIEWERS[user.id];

    const resolvedParams = await searchParams || {};
    const page = parseInt(resolvedParams.page || '1', 10);
    const examFilter = resolvedParams.exam || 'ALL';
    const sectionFilter = resolvedParams.section || 'ALL';

    // Fetch filter options
    let exams = [];
    let sections = [];
    let client;
    try {
        client = await db.connect();
        const examsRes = await client.query(`SELECT DISTINCT name FROM exam WHERE name IS NOT NULL ORDER BY name ASC`);
        exams = examsRes.rows.map(r => r.name);

        const sectionsRes = await client.query(`
            SELECT es.section_id, es.name AS section_name, e.name AS exam_name
            FROM exam_section es
            JOIN exam e ON es.exam_id = e.exam_id
            ORDER BY e.name ASC, es.sort_order ASC
        `);
        sections = sectionsRes.rows;
    } catch (e) {
        console.error('Filter fetch error:', e);
    } finally {
        client?.release();
    }

    const { questions, total, totalPages } = await fetchUnverifiedQuestions(page, 100, userSlot, examFilter, sectionFilter);

    return (
        <div className="bg-gray-50 min-h-screen">
            <div className="container mx-auto px-4 py-8">
                <header className="mb-6 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                    <h1 className="text-2xl font-bold text-gray-900 mb-1">Verify UnLink</h1>
                    <p className="text-sm text-gray-500">
                        Leftover unlinked questions from papers with 90%+ reviewed links.
                        Edit and save to mark each question as verified.
                    </p>
                    <p className="text-sm font-semibold text-gray-700 mt-2">
                        {total} question{total !== 1 ? 's' : ''} remaining
                        {!user.isAdmin && <span className="text-gray-400 font-normal ml-2">(your assigned portion)</span>}
                    </p>
                </header>

                <VerifyUnlinkFilters exams={exams} sections={sections} />

                <VerifyUnlink
                    initialQuestions={questions}
                    total={total}
                    currentPage={page}
                    totalPages={totalPages}
                />
            </div>
        </div>
    );
}
