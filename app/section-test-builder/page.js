import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import MockTestBuilder from '@/components/MockTestBuilder';

export const dynamic = 'force-dynamic';

export default async function SectionTestBuilderPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');

    const client = await db.connect();
    try {
        const [sectionTestsRes, examsRes] = await Promise.all([
            client.query(`
                SELECT mock_test_id, name, exam_id, status, type
                FROM mock_test
                WHERE status = 'DRAFT' AND type = 'SECTION'
                ORDER BY created_at DESC
            `),
            client.query(`
                SELECT e.exam_id, e.name, e.code,
                    json_agg(json_build_object(
                        'section_id', es.section_id,
                        'code', es.code,
                        'name', es.name,
                        'num_questions', es.num_questions
                    ) ORDER BY es.sort_order ASC NULLS LAST) AS sections
                FROM exam e
                JOIN exam_section es ON es.exam_id = e.exam_id
                GROUP BY e.exam_id, e.name, e.code
                ORDER BY e.name ASC
            `),
        ]);

        return (
            <MockTestBuilder
                mockTests={sectionTestsRes.rows}
                exams={examsRes.rows}
                testType="SECTION"
            />
        );
    } finally {
        client.release();
    }
}
