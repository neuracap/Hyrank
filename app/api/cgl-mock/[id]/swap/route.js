import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import {
    CGL_T1_EXAM_ID, TARGET_SECTION_IDS, BANK_SECTION_IDS, SECTION_CODES,
    SUBTYPE_PREFIXES,
} from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TARGET_TO_BANK = Object.fromEntries(
    SECTION_CODES.map(c => [TARGET_SECTION_IDS[c], BANK_SECTION_IDS[c]])
);
const TARGET_TO_CODE = Object.fromEntries(
    SECTION_CODES.map(c => [TARGET_SECTION_IDS[c], c])
);

/**
 * POST /api/cgl-mock/[id]/swap
 * Body: { question_id }
 * If the question is grouped, swaps the WHOLE GROUP for a fresh group of the
 * same type (keeps the pair-atomicity rule). Otherwise swaps the single
 * question for a replacement matching subtype prefix + difficulty band,
 * unused in any prior CGL T1 mock and in this mock.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { question_id, target_spec_subtype, target_difficulty } = body;
    if (!question_id) return NextResponse.json({ error: 'question_id required' }, { status: 400 });

    // Validate optional overrides
    if (target_spec_subtype && !SUBTYPE_PREFIXES[target_spec_subtype]) {
        return NextResponse.json({ error: `Unknown spec_subtype: ${target_spec_subtype}` }, { status: 400 });
    }
    let parsedDifficulty = null;
    if (target_difficulty != null && target_difficulty !== '') {
        parsedDifficulty = parseInt(target_difficulty, 10);
        if (![1, 2, 3, 4].includes(parsedDifficulty)) {
            return NextResponse.json({ error: 'target_difficulty must be 1, 2, 3, or 4' }, { status: 400 });
        }
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Locate the slot to swap.
        const slotRes = await client.query(`
            SELECT mtq.position, mtq.exam_section_id, mtq.slot_subtype, mtq.slot_difficulty, mtq.group_id,
                   qv.subtype, qv.difficulty
            FROM mock_test_question mtq
            JOIN question_version qv ON qv.question_id = mtq.question_id AND qv.language='EN'
            WHERE mtq.mock_test_id = $1 AND mtq.question_id = $2
        `, [mockTestId, question_id]);
        if (slotRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Question not found in this mock' }, { status: 404 });
        }
        const slot = slotRes.rows[0];
        const sectionCode = TARGET_TO_CODE[slot.exam_section_id];
        const bankSectionId = TARGET_TO_BANK[slot.exam_section_id];
        if (!sectionCode || !bankSectionId) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Could not map section' }, { status: 500 });
        }

        // Exclusion: any qid used in any prior CGL T1 mock, plus what's in this mock.
        const exclRes = await client.query(`
            SELECT DISTINCT mtq.question_id
            FROM mock_test_question mtq
            JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
            WHERE mt.exam_id = $1
        `, [CGL_T1_EXAM_ID]);
        const excluded = new Set(exclRes.rows.map(r => r.question_id));

        // -------- GROUP SWAP --------
        if (slot.group_id) {
            // Remove all members of this group from the mock.
            const oldMembersRes = await client.query(`
                SELECT question_id, position FROM mock_test_question
                WHERE mock_test_id = $1 AND group_id = $2
                ORDER BY position
            `, [mockTestId, slot.group_id]);
            const oldPositions = oldMembersRes.rows.map(r => r.position).sort((a, b) => a - b);
            const oldSize = oldMembersRes.rows.length;

            // Find candidate replacement groups (same group_type) with enough members and none excluded.
            const grpRes = await client.query(`
                SELECT qg.group_id, qg.group_type,
                       array_agg(qv.question_id ORDER BY qv.group_order NULLS LAST) AS member_ids,
                       array_agg(qv.difficulty   ORDER BY qv.group_order NULLS LAST) AS difficulties
                FROM question_group qg
                JOIN question_version qv ON qv.group_id = qg.group_id AND qv.language='EN' AND qv.question_type='MCQ' AND qv.source_type='bank'
                WHERE qg.exam_section_id = $1
                  AND qv.solution_status = 'DONE'
                  AND qv.correct_option_label IS NOT NULL
                  AND COALESCE(qv.status, '') != 'JUNK'
                  AND qv.difficulty IN (1,2,3,4)
                  AND qg.group_id != $2
                GROUP BY qg.group_id, qg.group_type
                HAVING qg.group_type = $3
            `, [bankSectionId, slot.group_id, (await client.query(`SELECT group_type FROM question_group WHERE group_id=$1`, [slot.group_id])).rows[0]?.group_type]);

            // Filter: no excluded members, size matches old size.
            const usable = grpRes.rows.filter(g =>
                g.member_ids.length === oldSize && g.member_ids.every(mid => !excluded.has(mid))
            );
            if (usable.length === 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'No replacement group available with the same size and fresh members.' }, { status: 409 });
            }
            const pick = usable[Math.floor(Math.random() * usable.length)];

            // Delete old, insert new at same positions.
            await client.query(`
                DELETE FROM mock_test_question WHERE mock_test_id = $1 AND group_id = $2
            `, [mockTestId, slot.group_id]);

            for (let i = 0; i < pick.member_ids.length; i++) {
                await client.query(`
                    INSERT INTO mock_test_question
                      (mock_test_id, question_id, exam_section_id, position,
                       slot_subtype, slot_difficulty, group_id, review_status, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', NOW())
                `, [
                    mockTestId,
                    pick.member_ids[i],
                    slot.exam_section_id,
                    oldPositions[i] ?? null,
                    pick.group_type,
                    pick.difficulties[i] != null ? String(pick.difficulties[i]) : null,
                    pick.group_id,
                ]);
            }
            await client.query('COMMIT');
            return NextResponse.json({
                success: true,
                swapped: 'group',
                old_group_id: slot.group_id,
                new_group_id: pick.group_id,
                size: pick.member_ids.length,
            });
        }

        // -------- SINGLE QUESTION SWAP --------
        // Resolve the subtype family + difficulty for the replacement.
        // Overrides (when caller passed them) take precedence; otherwise stick
        // with the slot's existing family + difficulty.
        const effectiveSpecSubtype = target_spec_subtype || slot.slot_subtype ||
            (slot.subtype ? slot.subtype.split('_')[0] : null);
        if (!effectiveSpecSubtype) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'No subtype context for swap' }, { status: 500 });
        }
        const effectiveDifficulty = parsedDifficulty != null ? parsedDifficulty : slot.difficulty;

        // Build the LIKE patterns to match the spec_subtype family. Use the
        // SUBTYPE_PREFIXES map when the spec key is known; fall back to a
        // single prefix from the old behavior otherwise.
        const likePatterns = SUBTYPE_PREFIXES[effectiveSpecSubtype]
            || [`${effectiveSpecSubtype}%`];

        const candRes = await client.query(`
            SELECT qv.question_id, qv.subtype, qv.difficulty, qv.leaf_topic_id,
                   qv.correct_option_label
            FROM question_version qv
            WHERE qv.source_type = 'bank' AND qv.question_type = 'MCQ' AND qv.language = 'EN'
              AND qv.solution_status = 'DONE'
              AND qv.correct_option_label IS NOT NULL
              AND COALESCE(qv.status, '') != 'JUNK'
              AND qv.exam_section_id = $1
              AND qv.difficulty = $2
              AND qv.subtype LIKE ANY($3)
              AND qv.group_id IS NULL
            LIMIT 200
        `, [bankSectionId, effectiveDifficulty, likePatterns]);

        const fresh = candRes.rows.filter(r => !excluded.has(r.question_id));
        if (fresh.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({
                error: `No fresh replacement available for spec_subtype="${effectiveSpecSubtype}" at difficulty L${effectiveDifficulty}.`,
            }, { status: 409 });
        }
        // Prefer a different bank-subtype than the old one (variation diversity).
        const oldFullSubtype = slot.subtype;
        const differentVariation = fresh.filter(r => r.subtype !== oldFullSubtype);
        const pickPool = differentVariation.length > 0 ? differentVariation : fresh;
        const pick = pickPool[Math.floor(Math.random() * pickPool.length)];

        // Persist any changes to slot_subtype/slot_difficulty so downstream
        // stats/analysis reflect the new bucket.
        const newSlotSubtype = target_spec_subtype || slot.slot_subtype;
        const newSlotDifficulty = parsedDifficulty != null
            ? String(parsedDifficulty)
            : slot.slot_difficulty;

        await client.query(`
            DELETE FROM mock_test_question WHERE mock_test_id = $1 AND question_id = $2
        `, [mockTestId, question_id]);
        await client.query(`
            INSERT INTO mock_test_question
              (mock_test_id, question_id, exam_section_id, position,
               slot_subtype, slot_difficulty, group_id, review_status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NULL, 'PENDING', NOW())
        `, [
            mockTestId,
            pick.question_id,
            slot.exam_section_id,
            slot.position,
            newSlotSubtype,
            newSlotDifficulty,
        ]);
        await client.query('COMMIT');
        return NextResponse.json({
            success: true,
            swapped: 'single',
            old_question_id: question_id,
            new_question_id: pick.question_id,
            new_subtype: pick.subtype,
            new_difficulty: pick.difficulty,
            new_slot_subtype: newSlotSubtype,
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('cgl-mock/swap error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
