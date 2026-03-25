import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mock-test/list?exam_id=xxx&status=DRAFT
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const examId = searchParams.get('exam_id');
    const status = searchParams.get('status');

    try {
        let sql = `
            SELECT
                mt.mock_test_id, mt.name, mt.slug, mt.status,
                mt.exam_id, mt.blueprint_id, mt.stats_json,
                mt.created_by, mt.published_at, mt.created_at, mt.updated_at,
                e.name AS exam_name,
                mb.name AS blueprint_name,
                COUNT(mtq.question_id) AS total_questions,
                COUNT(mtq.question_id) FILTER (WHERE mtq.review_status = 'APPROVED') AS approved_count,
                COUNT(mtq.question_id) FILTER (WHERE mtq.review_status = 'REJECTED') AS rejected_count,
                COUNT(mtq.question_id) FILTER (WHERE mtq.review_status = 'PENDING') AS pending_count
            FROM mock_test mt
            LEFT JOIN exam e ON e.exam_id = mt.exam_id
            LEFT JOIN mock_blueprint mb ON mb.blueprint_id = mt.blueprint_id
            LEFT JOIN mock_test_question mtq ON mtq.mock_test_id = mt.mock_test_id
            WHERE 1=1
        `;
        const params = [];

        if (examId) {
            params.push(examId);
            sql += ` AND mt.exam_id = $${params.length}`;
        }
        if (status) {
            params.push(status);
            sql += ` AND mt.status = $${params.length}`;
        }

        sql += ` GROUP BY mt.mock_test_id, e.name, mb.name ORDER BY mt.created_at DESC`;

        const result = await db.query(sql, params);
        return NextResponse.json({ mocks: result.rows });
    } catch (e) {
        console.error('mock-test/list error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
