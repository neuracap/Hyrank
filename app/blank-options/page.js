import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import BlankOptionsAudit from '@/components/BlankOptionsAudit';

export const dynamic = 'force-dynamic';

export default async function BlankOptionsPage({ searchParams }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) redirect('/login');

    const resolvedParams = await searchParams || {};
    const page = parseInt(resolvedParams.page || '1', 10);
    const examFilter = resolvedParams.exam || 'ALL';
    const limit = 50;
    const offset = (page - 1) * limit;

    let client;
    try {
        client = await db.connect();

        const examsRes = await client.query(
            `SELECT DISTINCT name FROM exam WHERE name IS NOT NULL ORDER BY name ASC`
        );
        const exams = examsRes.rows.map(r => r.name);

        const params = [limit, offset];
        let examClause = '';
        if (examFilter !== 'ALL') {
            examClause = `AND e.name = $3`;
            params.push(examFilter);
        }

        // Questions that are MANUALLY_CORRECTED but have at least one blank option (A/B/C/D)
        const questionsRes = await client.query(`
            WITH blank_option_questions AS (
                SELECT
                    qo.question_id, qo.version_no, qo.language,
                    COUNT(*) AS total_options,
                    COUNT(*) FILTER (
                        WHERE COALESCE(TRIM(qo.option_json->>'text'), '') = ''
                    ) AS blank_options,
                    array_agg(
                        CASE WHEN COALESCE(TRIM(qo.option_json->>'text'), '') = ''
                        THEN qo.option_key END
                        ORDER BY qo.option_key
                    ) FILTER (
                        WHERE COALESCE(TRIM(qo.option_json->>'text'), '') = ''
                    ) AS blank_keys
                FROM question_option qo
                WHERE qo.option_key IN ('A','B','C','D')
                GROUP BY qo.question_id, qo.version_no, qo.language
                HAVING COUNT(*) FILTER (
                    WHERE COALESCE(TRIM(qo.option_json->>'text'), '') = ''
                ) >= 1
                AND COUNT(*) FILTER (
                    WHERE COALESCE(TRIM(qo.option_json->>'text'), '') = ''
                ) < 4
            )
            SELECT
                qv.question_id AS id,
                qv.version_no,
                qv.language,
                qv.body_json->>'text' AS question_text,
                qv.source_question_no,
                qv.question_number_int,
                qv.status,
                ps.paper_session_id,
                ps.session_label,
                e.name AS exam_name,
                es.code AS section_code,
                boq.blank_options,
                boq.blank_keys,
                (SELECT ij.source_pdf_path
                 FROM raw_mmd_doc d
                 JOIN import_job ij ON d.import_job_id = ij.import_job_id
                 WHERE d.raw_mmd_doc_id = ps.raw_mmd_doc_id
                 LIMIT 1) AS source_pdf_path
            FROM blank_option_questions boq
            JOIN question_version qv
                ON qv.question_id = boq.question_id
                AND qv.version_no = boq.version_no
                AND qv.language = boq.language
            LEFT JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE qv.status = 'MANUALLY_CORRECTED'
            ${examClause}
            ORDER BY e.name ASC NULLS LAST,
                     ps.session_label ASC,
                     qv.question_number_int ASC NULLS LAST
            LIMIT $1 OFFSET $2
        `, params);

        // Count
        const countParams = [];
        let countExamClause = '';
        if (examFilter !== 'ALL') {
            countExamClause = `AND e.name = $1`;
            countParams.push(examFilter);
        }

        const countRes = await client.query(`
            WITH blank_option_questions AS (
                SELECT qo.question_id, qo.version_no, qo.language
                FROM question_option qo
                WHERE qo.option_key IN ('A','B','C','D')
                GROUP BY qo.question_id, qo.version_no, qo.language
                HAVING COUNT(*) FILTER (
                    WHERE COALESCE(TRIM(qo.option_json->>'text'), '') = ''
                ) BETWEEN 1 AND 3
            )
            SELECT COUNT(*) AS c
            FROM blank_option_questions boq
            JOIN question_version qv
                ON qv.question_id = boq.question_id
                AND qv.version_no = boq.version_no
                AND qv.language = boq.language
            LEFT JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            WHERE qv.status = 'MANUALLY_CORRECTED'
            ${countExamClause}
        `, countParams);

        const total = parseInt(countRes.rows[0].c);
        const totalPages = Math.ceil(total / limit);

        // Fetch options
        const allIds = questionsRes.rows.map(q => q.id);
        let allOptions = [];
        if (allIds.length > 0) {
            const optRes = await client.query(`
                SELECT question_id, version_no, language,
                       option_key AS opt_label,
                       option_json->>'text' AS opt_text
                FROM question_option
                WHERE question_id = ANY($1)
                ORDER BY option_key ASC
            `, [allIds]);
            allOptions = optRes.rows;
        }

        const questions = questionsRes.rows.map(q => ({
            ...q,
            options: allOptions.filter(
                o => o.question_id === q.id && o.version_no === q.version_no && o.language === q.language
            ),
        }));

        client.release();

        return (
            <BlankOptionsAudit
                questions={questions}
                total={total}
                currentPage={page}
                totalPages={totalPages}
                exams={exams}
                examFilter={examFilter}
            />
        );
    } catch (err) {
        console.error('BlankOptionsPage error:', err);
        client?.release();
        return (
            <div className="container mx-auto px-4 py-8">
                <h1 className="text-2xl font-bold text-red-600">Error</h1>
                <p className="text-gray-500 mt-2">{err.message}</p>
            </div>
        );
    }
}
