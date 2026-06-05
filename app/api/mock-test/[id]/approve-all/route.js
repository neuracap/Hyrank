import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mock-test/[id]/approve-all
 *
 * One-shot approval: marks every mock_test_question.review_status='APPROVED'
 * for this mock and flips mock_test.status='APPROVED'. Refuses if any
 * placeholders are still unfilled (placeholders aren't real questions yet).
 *
 * This is the gate that's missing between DRAFT and the existing
 * /publish route, which requires status='APPROVED'.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;

    const client = await db.connect();
    try {
        const mockRes = await client.query(
            `SELECT mock_test_id, status, stats_json FROM mock_test WHERE mock_test_id = $1`,
            [id]
        );
        if (mockRes.rows.length === 0) {
            return NextResponse.json({ error: 'Mock not found' }, { status: 404 });
        }
        const mock = mockRes.rows[0];
        if (mock.status === 'PUBLISHED') {
            return NextResponse.json({ error: 'Already published' }, { status: 409 });
        }

        const placeholders = Array.isArray(mock.stats_json?.placeholders) ? mock.stats_json.placeholders : [];
        if (placeholders.length > 0) {
            return NextResponse.json({
                error: `${placeholders.length} placeholder(s) still unfilled — fill or remove them before approving.`,
                placeholder_count: placeholders.length,
            }, { status: 400 });
        }

        await client.query('BEGIN');
        const updatedQs = await client.query(
            `UPDATE mock_test_question
             SET review_status = 'APPROVED'
             WHERE mock_test_id = $1
             RETURNING question_id`,
            [id]
        );
        await client.query(
            `UPDATE mock_test
             SET status = 'APPROVED', updated_at = NOW()
             WHERE mock_test_id = $1`,
            [id]
        );
        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            questions_approved: updatedQs.rowCount,
            status: 'APPROVED',
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('mock-test/approve-all error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
