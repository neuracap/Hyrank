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
    let sections = [];
    let client;
    try {
        client = await db.connect();

        // Exams with image questions (from reviewed papers only)
        const examsRes2 = await client.query(`
            SELECT DISTINCT e.name AS exam_name, e.exam_id
            FROM exam e
            JOIN paper_session ps ON ps.exam_id = e.exam_id
            JOIN question_version qv ON qv.paper_session_id = ps.paper_session_id
                AND qv.language = 'EN' AND qv.has_image = true
                AND qv.status IN ('MANUALLY_CORRECTED', 'FLAGGED')
            WHERE ps.status != 'NOT_REVIEWED' AND e.name IS NOT NULL
            ORDER BY e.name
        `);
        papers = examsRes2.rows;

        // Distinct sections that have image questions
        const sectionsRes = await client.query(`
            SELECT DISTINCT es.code
            FROM question_version qv
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE qv.has_image = true AND qv.language = 'EN'
              AND qv.status IN ('MANUALLY_CORRECTED', 'FLAGGED')
              AND es.code IS NOT NULL
            ORDER BY es.code
        `);
        sections = sectionsRes.rows.map(r => r.code);

    } catch (err) {
        console.error('ImageSolutionsPage DB error:', err);
    } finally {
        client?.release();
    }

    return <ImageSolutions papers={papers} sections={sections} />;
}
