import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import MockTestManager from '@/components/MockTestManager';

export const dynamic = 'force-dynamic';

export default async function MockTestsPage() {
    const user = await getCurrentUser();
    if (!user || !user.isAdmin) {
        redirect('/login');
    }

    let exams = [];
    let client;
    try {
        client = await db.connect();
        const res = await client.query(`
            SELECT e.exam_id, e.name,
                   json_agg(json_build_object(
                       'section_id', es.section_id,
                       'code', es.code,
                       'name', es.name,
                       'sort_order', es.sort_order
                   ) ORDER BY es.sort_order ASC NULLS LAST) AS sections
            FROM exam e
            LEFT JOIN exam_section es ON es.exam_id = e.exam_id
            GROUP BY e.exam_id, e.name
            HAVING COUNT(es.section_id) > 0
            ORDER BY e.name ASC
        `);
        exams = res.rows;
    } catch (err) {
        console.error('MockTestsPage DB error:', err);
    } finally {
        client?.release();
    }

    return <MockTestManager exams={exams} />;
}
