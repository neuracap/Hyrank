import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mock-test/[id]/hindi-review/approve
 *
 * Body: { question_id, version_no }
 * Flips question_version (HI) status='APPROVED' for one question of this mock.
 *
 * Also accepts: { all: true } — approves every translated HI row in this mock.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const client = await db.connect();
    try {
        if (body?.all === true) {
            const r = await client.query(`
                UPDATE question_version qv
                SET status = 'APPROVED', updated_at = NOW()
                FROM mock_test_question mtq
                WHERE mtq.mock_test_id = $1
                  AND qv.question_id = mtq.question_id
                  AND qv.language = 'HI'
                  AND qv.status != 'APPROVED'
                RETURNING qv.question_id
            `, [mockTestId]);
            return NextResponse.json({ success: true, approved: r.rowCount });
        }

        const { question_id, version_no } = body || {};
        if (!question_id || version_no == null) {
            return NextResponse.json({ error: 'question_id and version_no required' }, { status: 400 });
        }
        const present = await client.query(
            `SELECT 1 FROM mock_test_question WHERE mock_test_id = $1 AND question_id = $2`,
            [mockTestId, question_id]
        );
        if (present.rows.length === 0) {
            return NextResponse.json({ error: 'Question not in this mock' }, { status: 404 });
        }
        const r = await client.query(`
            UPDATE question_version
            SET status = 'APPROVED', updated_at = NOW()
            WHERE question_id = $1 AND version_no = $2 AND language = 'HI'
            RETURNING question_id
        `, [question_id, version_no]);
        if (r.rowCount === 0) {
            return NextResponse.json({ error: 'HI version not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, approved: 1 });
    } catch (e) {
        console.error('hindi-review/approve error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
