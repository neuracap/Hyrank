import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

/**
 * POST /api/mock-test/[id]/swap
 * Replace a rejected question with a new one.
 * Body: { old_question_id, new_question_id }
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { old_question_id, new_question_id } = await req.json();

    if (!old_question_id || !new_question_id) {
        return NextResponse.json({ error: 'old_question_id and new_question_id are required' }, { status: 400 });
    }

    const client = await db.connect();

    try {
        // 1. Verify the old question exists in this mock and is rejected
        const oldRes = await client.query(`
            SELECT exam_section_id, position, slot_subtype, slot_difficulty, group_id
            FROM mock_test_question
            WHERE mock_test_id = $1 AND question_id = $2
        `, [id, old_question_id]);

        if (oldRes.rows.length === 0) {
            client.release();
            return NextResponse.json({ error: 'Original question not found in this mock' }, { status: 404 });
        }

        const slot = oldRes.rows[0];

        // 2. Verify new question isn't already in this mock
        const dupCheck = await client.query(`
            SELECT 1 FROM mock_test_question
            WHERE mock_test_id = $1 AND question_id = $2
        `, [id, new_question_id]);

        if (dupCheck.rows.length > 0) {
            client.release();
            return NextResponse.json({ error: 'New question is already in this mock' }, { status: 409 });
        }

        await client.query('BEGIN');

        // 3. Delete the old question
        await client.query(`
            DELETE FROM mock_test_question
            WHERE mock_test_id = $1 AND question_id = $2
        `, [id, old_question_id]);

        // 4. Insert the new question with same slot metadata
        await client.query(`
            INSERT INTO mock_test_question
            (mock_test_id, question_id, exam_section_id, position,
             slot_subtype, slot_difficulty, review_status, group_id, score, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, 0, NOW())
        `, [
            id,
            new_question_id,
            slot.exam_section_id,
            slot.position,
            slot.slot_subtype,
            slot.slot_difficulty,
            slot.group_id,
        ]);

        // 5. If mock was APPROVED, move back to IN_REVIEW
        await client.query(`
            UPDATE mock_test
            SET status = CASE WHEN status = 'APPROVED' THEN 'IN_REVIEW' ELSE status END,
                updated_at = NOW()
            WHERE mock_test_id = $1
        `, [id]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            swapped: { old: old_question_id, new: new_question_id },
            position: slot.position,
        });

    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('mock-test/swap error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
