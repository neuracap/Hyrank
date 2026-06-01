import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { CGL_T1_EXAM_ID } from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cgl-mock/[id]/replace-with
 * Body: { question_id_to_remove, replacement_question_id }
 *
 * Hand-picked replacement — caller already chose the new question (e.g. from
 * /api/cgl-mock/search-bank). Used when the user wants to deliberately switch
 * to a different subtype/topic rather than letting /swap pick from the same
 * family.
 *
 * Constraints:
 *   - The old question must be in this mock and NOT part of a group (groups
 *     have to swap as a unit via the existing /swap endpoint).
 *   - The replacement must not already be in any prior CGL T1 mock or in this
 *     mock.
 *   - The replacement is inserted at the old question's same position +
 *     exam_section_id, with slot_subtype set to the replacement's actual
 *     subtype so the variation-diversity check stays meaningful.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { question_id_to_remove, replacement_question_id } = body;
    if (!question_id_to_remove || !replacement_question_id) {
        return NextResponse.json({ error: 'question_id_to_remove and replacement_question_id required' }, { status: 400 });
    }
    if (question_id_to_remove === replacement_question_id) {
        return NextResponse.json({ error: 'Replacement must be a different question' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const slotRes = await client.query(`
            SELECT mtq.position, mtq.exam_section_id, mtq.slot_subtype, mtq.slot_difficulty, mtq.group_id
            FROM mock_test_question mtq
            WHERE mtq.mock_test_id = $1 AND mtq.question_id = $2
        `, [mockTestId, question_id_to_remove]);
        if (slotRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Question not found in this mock' }, { status: 404 });
        }
        const slot = slotRes.rows[0];
        if (slot.group_id) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Use Swap group for grouped questions' }, { status: 409 });
        }

        // Refuse if replacement already in any CGL T1 mock.
        const dupeRes = await client.query(`
            SELECT 1 FROM mock_test_question mtq
            JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
            WHERE mtq.question_id = $1 AND mt.exam_id = $2 LIMIT 1
        `, [replacement_question_id, CGL_T1_EXAM_ID]);
        if (dupeRes.rows.length > 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Replacement is already used in a CGL T1 mock' }, { status: 409 });
        }

        // Load the replacement's subtype/difficulty for the slot metadata.
        const repRes = await client.query(`
            SELECT subtype, difficulty, language, group_id, status, solution_status, correct_option_label
            FROM question_version
            WHERE question_id = $1 AND language = 'EN'
            ORDER BY version_no DESC LIMIT 1
        `, [replacement_question_id]);
        if (repRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Replacement question not found' }, { status: 404 });
        }
        const rep = repRes.rows[0];
        if (rep.solution_status !== 'DONE' || !rep.correct_option_label) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Replacement is not verified (solution_status / correct_option_label missing)' }, { status: 409 });
        }
        if (rep.status === 'JUNK') {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Replacement is marked JUNK' }, { status: 409 });
        }
        if (rep.group_id) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Replacement is a grouped question — pick a standalone instead' }, { status: 409 });
        }

        // Delete old, insert new at the same position.
        await client.query(
            `DELETE FROM mock_test_question WHERE mock_test_id = $1 AND question_id = $2`,
            [mockTestId, question_id_to_remove]
        );
        await client.query(`
            INSERT INTO mock_test_question
              (mock_test_id, question_id, exam_section_id, position,
               slot_subtype, slot_difficulty, group_id, review_status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NULL, 'PENDING', NOW())
        `, [
            mockTestId,
            replacement_question_id,
            slot.exam_section_id,
            slot.position,
            rep.subtype || slot.slot_subtype,
            rep.difficulty != null ? String(rep.difficulty) : slot.slot_difficulty,
        ]);

        await client.query('COMMIT');
        return NextResponse.json({
            success: true,
            old_question_id: question_id_to_remove,
            new_question_id: replacement_question_id,
            new_subtype: rep.subtype,
            new_difficulty: rep.difficulty,
            position: slot.position,
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('cgl-mock/replace-with error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
