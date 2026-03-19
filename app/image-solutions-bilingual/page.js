import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import ImageSolutionsBilingual from '@/components/ImageSolutionsBilingual';

export const dynamic = 'force-dynamic';

export default async function ImageSolutionsBilingualPage() {
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
                e.name AS exam_name,
                COUNT(DISTINCT ql.id) AS pair_count,
                COUNT(DISTINCT ql.id) FILTER (
                    WHERE qe.solution_status = 'DONE'
                ) AS solved_count
            FROM paper_session ps
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            INNER JOIN question_links ql
                ON ql.paper_session_id_english = ps.paper_session_id
            INNER JOIN question_version qe
                ON qe.question_id = ql.english_question_id
                AND qe.version_no = ql.english_version_no
                AND qe.language = 'EN'
                AND (qe.has_image = true OR EXISTS (
                    SELECT 1 FROM question_version qh
                    WHERE qh.question_id = ql.hindi_question_id
                      AND qh.version_no = ql.hindi_version_no
                      AND qh.language = 'HI'
                      AND qh.has_image = true
                ))
            GROUP BY ps.paper_session_id, ps.session_label, ps.paper_date, ps.subject, e.name
            HAVING COUNT(DISTINCT ql.id) > 0
            ORDER BY ps.paper_date DESC NULLS LAST
        `);
        papers = res.rows;
    } catch (err) {
        console.error('ImageSolutionsBilingualPage DB error:', err);
    } finally {
        client?.release();
    }

    return <ImageSolutionsBilingual papers={papers} />;
}
