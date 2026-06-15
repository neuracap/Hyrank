import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import SolutionReview from '@/components/SolutionReview';
import SolutionReviewList from '@/components/SolutionReviewList';

export const dynamic = 'force-dynamic';

export default async function SolutionReviewPage({ searchParams }) {
    const user = await getCurrentUser();
    if (!user || !user.isAdmin) {
        redirect('/login');
    }

    const resolvedParams = await searchParams || {};
    const paperId = resolvedParams.paperId;
    const lang = resolvedParams.lang || 'EN';

    // If a paper is selected, show the solution review for that paper
    if (paperId) {
        return <SolutionReview paperId={paperId} language={lang} />;
    }

    // Otherwise show the papers table
    const examFilter = resolvedParams.exam || 'ALL';
    const statusFilter = resolvedParams.status || 'ALL';
    const yearFilter = resolvedParams.year || 'ALL';
    const page = parseInt(resolvedParams.page || '1', 10);
    const limit = 100;
    const offset = (page - 1) * limit;

    let client;
    try {
        client = await db.connect();

        // Exams for filter
        const examsRes = await client.query(
            `SELECT DISTINCT e.name FROM exam e WHERE e.name IS NOT NULL ORDER BY e.name`
        );
        const exams = examsRes.rows.map(r => r.name);

        // Years that actually appear on paper_session rows
        const yearsRes = await client.query(
            `SELECT DISTINCT EXTRACT(YEAR FROM paper_date)::int AS y
             FROM paper_session
             WHERE paper_date IS NOT NULL
             ORDER BY y DESC`
        );
        const years = yearsRes.rows.map(r => r.y);

        // Build filters
        const conditions = [];
        const params = [];
        let paramIdx = 1;

        if (examFilter !== 'ALL') {
            conditions.push(`e.name = $${paramIdx}`);
            params.push(examFilter);
            paramIdx++;
        }
        if (statusFilter !== 'ALL') {
            conditions.push(`ps.status = $${paramIdx}`);
            params.push(statusFilter);
            paramIdx++;
        }
        if (yearFilter !== 'ALL') {
            const yr = parseInt(yearFilter, 10);
            if (Number.isInteger(yr)) {
                conditions.push(`EXTRACT(YEAR FROM ps.paper_date) = $${paramIdx}`);
                params.push(yr);
                paramIdx++;
            }
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Papers with 80%+ solutions
        const papersRes = await client.query(`
            SELECT
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.language,
                ps.status AS pipeline_status,
                e.name AS exam_name,
                qv_s.total_q,
                qv_s.solved_q,
                qv_s.image_q,
                CASE WHEN EXISTS (
                    SELECT 1 FROM question_links ql
                    WHERE ql.paper_session_id_english = ps.paper_session_id
                       OR ql.paper_session_id_hindi = ps.paper_session_id
                ) THEN true ELSE false END AS is_linked
            FROM paper_session ps
            LEFT JOIN exam e ON e.exam_id = ps.exam_id
            JOIN (
                SELECT
                    paper_session_id,
                    COUNT(*) AS total_q,
                    COUNT(*) FILTER (WHERE solution_status = 'DONE') AS solved_q,
                    COUNT(*) FILTER (WHERE has_image = true) AS image_q
                FROM question_version
                GROUP BY paper_session_id
                HAVING COUNT(*) > 0
                   AND COUNT(*) FILTER (WHERE solution_status = 'DONE') >= 0.8 * COUNT(*)
            ) qv_s ON qv_s.paper_session_id = ps.paper_session_id
            ${whereClause}
            ORDER BY ps.paper_date DESC NULLS LAST, ps.session_label ASC
            LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `, [...params, limit, offset]);

        // Count
        const countRes = await client.query(`
            SELECT COUNT(*) AS c
            FROM paper_session ps
            LEFT JOIN exam e ON e.exam_id = ps.exam_id
            JOIN (
                SELECT paper_session_id
                FROM question_version
                GROUP BY paper_session_id
                HAVING COUNT(*) > 0
                   AND COUNT(*) FILTER (WHERE solution_status = 'DONE') >= 0.8 * COUNT(*)
            ) qv_s ON qv_s.paper_session_id = ps.paper_session_id
            ${whereClause}
        `, params);
        const total = parseInt(countRes.rows[0].c);
        const totalPages = Math.ceil(total / limit);

        client.release();

        return (
            <SolutionReviewList
                papers={papersRes.rows}
                exams={exams}
                years={years}
                examFilter={examFilter}
                statusFilter={statusFilter}
                yearFilter={yearFilter}
                currentPage={page}
                totalPages={totalPages}
                total={total}
            />
        );
    } catch (err) {
        console.error('SolutionReviewPage error:', err);
        client?.release();
        return <div className="p-8 text-red-600">Error: {err.message}</div>;
    }
}
