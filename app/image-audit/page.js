import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import ImageAudit from '@/components/ImageAudit';

export const dynamic = 'force-dynamic';

export default async function ImageAuditPage({ searchParams }) {
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

        // Fetch exam list for filter
        const examsRes = await client.query(
            `SELECT DISTINCT name FROM exam WHERE name IS NOT NULL ORDER BY name ASC`
        );
        const exams = examsRes.rows.map(r => r.name);

        // Build exam filter
        const params = [limit, offset];
        let examClause = '';
        if (examFilter !== 'ALL') {
            examClause = `AND e.name = $3`;
            params.push(examFilter);
        }

        // Find questions where exactly 1 option has an image but not all 4
        // An option "has image" if option_json::text contains includegraphics or ![
        const questionsRes = await client.query(`
            WITH option_image_counts AS (
                SELECT
                    qo.question_id,
                    qo.version_no,
                    qo.language,
                    COUNT(*) AS total_options,
                    COUNT(*) FILTER (
                        WHERE qo.option_json::text ILIKE '%includegraphics%'
                           OR qo.option_json::text ILIKE '%![%'
                           OR qo.option_json::text ILIKE '%./images/%'
                    ) AS image_options
                FROM question_option qo
                GROUP BY qo.question_id, qo.version_no, qo.language
                HAVING COUNT(*) >= 4
                   AND COUNT(*) FILTER (
                        WHERE qo.option_json::text ILIKE '%includegraphics%'
                           OR qo.option_json::text ILIKE '%![%'
                           OR qo.option_json::text ILIKE '%./images/%'
                   ) BETWEEN 1 AND 3
            )
            SELECT
                qv.question_id AS id,
                qv.version_no,
                qv.language,
                qv.body_json->>'text' AS question_text,
                qv.source_question_no,
                qv.has_image,
                qv.status,
                qv.question_number_int,
                ps.paper_session_id,
                ps.session_label,
                e.name AS exam_name,
                es.code AS section_code,
                oic.image_options,
                oic.total_options
            FROM option_image_counts oic
            JOIN question_version qv
                ON qv.question_id = oic.question_id
                AND qv.version_no = oic.version_no
                AND qv.language = oic.language
            LEFT JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE 1=1 ${examClause}
            ORDER BY e.name ASC NULLS LAST,
                     ps.session_label ASC,
                     qv.question_number_int ASC NULLS LAST
            LIMIT $1 OFFSET $2
        `, params);

        // Count total
        const countParams = [];
        let countExamClause = '';
        if (examFilter !== 'ALL') {
            countExamClause = `AND e.name = $1`;
            countParams.push(examFilter);
        }

        const countRes = await client.query(`
            WITH option_image_counts AS (
                SELECT qo.question_id, qo.version_no, qo.language
                FROM question_option qo
                GROUP BY qo.question_id, qo.version_no, qo.language
                HAVING COUNT(*) >= 4
                   AND COUNT(*) FILTER (
                        WHERE qo.option_json::text ILIKE '%includegraphics%'
                           OR qo.option_json::text ILIKE '%![%'
                           OR qo.option_json::text ILIKE '%./images/%'
                   ) BETWEEN 1 AND 3
            )
            SELECT COUNT(*) AS c
            FROM option_image_counts oic
            JOIN question_version qv
                ON qv.question_id = oic.question_id
                AND qv.version_no = oic.version_no
                AND qv.language = oic.language
            LEFT JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            WHERE 1=1 ${countExamClause}
        `, countParams);

        const total = parseInt(countRes.rows[0].c);
        const totalPages = Math.ceil(total / limit);

        // Fetch options for these questions
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
            <ImageAudit
                questions={questions}
                total={total}
                currentPage={page}
                totalPages={totalPages}
                exams={exams}
                examFilter={examFilter}
            />
        );

    } catch (err) {
        console.error('ImageAuditPage error:', err);
        client?.release();
        return (
            <div className="container mx-auto px-4 py-8">
                <h1 className="text-2xl font-bold text-red-600">Error loading page</h1>
                <p className="text-gray-500 mt-2">{err.message}</p>
            </div>
        );
    }
}
