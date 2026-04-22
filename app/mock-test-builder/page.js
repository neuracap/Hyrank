import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import MockTestBuilder from '@/components/MockTestBuilder';

export const dynamic = 'force-dynamic';

export default async function MockTestBuilderPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    if (!user.isAdmin) redirect('/dashboard');

    const client = await db.connect();
    try {
        const [mockTestsRes, examsRes] = await Promise.all([
            client.query(`
                SELECT mock_test_id, name, exam_id, status
                FROM mock_test
                WHERE status = 'DRAFT'
                ORDER BY created_at DESC
            `),
            client.query(`
                SELECT exam_id, name, code
                FROM exam
                ORDER BY name ASC
            `),
        ]);

        return (
            <MockTestBuilder
                mockTests={mockTestsRes.rows}
                exams={examsRes.rows}
            />
        );
    } finally {
        client.release();
    }
}
