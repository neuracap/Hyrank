import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import ImageSolutions from '@/components/ImageSolutions';

export const dynamic = 'force-dynamic';

export default async function ImageSolutionsPage() {
    const user = await getCurrentUser();
    if (!user || !user.isAdmin) {
        redirect('/login');
    }

    let papers = [];
    let client;
    try {
        client = await db.connect();
        const res = await client.query(`
            SELECT
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.subject,
                ps.status,
                e.name AS exam_name,
                COUNT(qv.question_id) AS image_question_count,
                COUNT(qv.question_id) FILTER (
                    WHERE qv.solution_status = 'DONE'
                       OR (qv.solution_json->>'answer_label' IS NOT NULL
                           AND qv.solution_json->>'answer_label' != '')
                ) AS solved_count
            FROM paper_session ps
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            INNER JOIN question_version qv
                ON qv.paper_session_id = ps.paper_session_id
                AND qv.language = 'EN'
                AND qv.has_image = true
                AND qv.status IN ('MANUALLY_CORRECTED', 'FLAGGED')
            GROUP BY ps.paper_session_id, ps.session_label, ps.paper_date, ps.subject, ps.status, e.name
            ORDER BY ps.paper_date DESC NULLS LAST
        `);
        papers = res.rows;
    } catch (err) {
        console.error('ImageSolutionsPage DB error:', err);
    } finally {
        client?.release();
    }

    return <ImageSolutions papers={papers} />;
}
