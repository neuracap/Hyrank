import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

/**
 * POST /api/mock-test/[id]/publish
 * Publish an approved mock test.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const client = await db.connect();

    try {
        // 1. Verify mock exists and is approved
        const mockRes = await client.query(
            `SELECT mock_test_id, exam_id, name, status FROM mock_test WHERE mock_test_id = $1`, [id]
        );

        if (mockRes.rows.length === 0) {
            return NextResponse.json({ error: 'Mock test not found' }, { status: 404 });
        }

        const mock = mockRes.rows[0];

        if (mock.status !== 'APPROVED') {
            return NextResponse.json({
                error: `Cannot publish mock in ${mock.status} status. Run "Approve all" first.`
            }, { status: 400 });
        }

        // 2. Verify all questions are approved
        const pendingCheck = await client.query(`
            SELECT COUNT(*) AS cnt
            FROM mock_test_question
            WHERE mock_test_id = $1 AND review_status != 'APPROVED'
        `, [id]);

        if (parseInt(pendingCheck.rows[0].cnt) > 0) {
            return NextResponse.json({
                error: `${pendingCheck.rows[0].cnt} questions are not yet approved`
            }, { status: 400 });
        }

        await client.query('BEGIN');

        // 3. Publish
        await client.query(`
            UPDATE mock_test
            SET status = 'PUBLISHED', published_at = NOW(), updated_at = NOW()
            WHERE mock_test_id = $1
        `, [id]);

        // 4. Record all questions in question_usage for this exam
        //    This prevents these questions from being used in future tests for the same exam
        await client.query(`
            INSERT INTO question_usage (question_id, exam_id, usage_type, usage_ref_id, usage_label, created_at)
            SELECT
                mtq.question_id,
                $2,
                'MOCK_TEST',
                $1,
                $3,
                NOW()
            FROM mock_test_question mtq
            WHERE mtq.mock_test_id = $1
            ON CONFLICT (question_id, usage_ref_id) DO NOTHING
        `, [id, mock.exam_id, mock.name]);

        await client.query('COMMIT');

        return NextResponse.json({ success: true, status: 'PUBLISHED' });

    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('mock-test/publish error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
