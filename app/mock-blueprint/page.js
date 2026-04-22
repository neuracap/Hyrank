import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import MockBlueprintEditor from '@/components/MockBlueprintEditor';

export const dynamic = 'force-dynamic';

export default async function MockBlueprintPage() {
    const user = await getCurrentUser();
    if (!user || !user.isAdmin) redirect('/login');

    const client = await db.connect();
    try {
        const [examsRes, blueprintsRes] = await Promise.all([
            client.query(`
                SELECT e.exam_id, e.name, e.code,
                    json_agg(
                        json_build_object(
                            'section_id', es.section_id,
                            'code', es.code,
                            'name', es.name,
                            'num_questions', es.num_questions,
                            'sort_order', es.sort_order
                        ) ORDER BY es.sort_order ASC NULLS LAST
                    ) AS sections
                FROM exam e
                JOIN exam_section es ON es.exam_id = e.exam_id
                GROUP BY e.exam_id, e.name, e.code
                ORDER BY e.name ASC
            `),
            client.query(`
                SELECT b.blueprint_id, b.exam_id, b.name, b.config_json,
                       b.is_active, b.created_at, b.updated_at,
                       e.name AS exam_name
                FROM mock_blueprint b
                JOIN exam e ON e.exam_id = b.exam_id
                ORDER BY b.updated_at DESC
            `),
        ]);

        return (
            <MockBlueprintEditor
                exams={examsRes.rows}
                initialBlueprints={blueprintsRes.rows}
            />
        );
    } finally {
        client.release();
    }
}
