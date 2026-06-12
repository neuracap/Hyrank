import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { CGL_T1_EXAM_ID, TARGET_SECTION_IDS, BANK_SECTION_IDS, SECTION_CODES } from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TARGET_TO_CODE = Object.fromEntries(SECTION_CODES.map(c => [TARGET_SECTION_IDS[c], c]));
const TARGET_TO_BANK = Object.fromEntries(SECTION_CODES.map(c => [TARGET_SECTION_IDS[c], BANK_SECTION_IDS[c]]));

/**
 * POST /api/cgl-mock/[id]/junk
 * Body: { question_id, reason? }
 *
 * 1. Marks question_version.status = 'JUNK' on the EN row so the picker never
 *    serves it again (logged into meta_json.edit_history with the reason).
 * 2. Tries to swap it out of this mock (same subtype family + same difficulty,
 *    fresh variation, not in any prior CGL T1 mock). On success: returns the
 *    replacement.
 * 3. If no replacement is found OR the question is grouped, deletes its
 *    mock_test_question row(s) and adds a placeholder back to
 *    stats_json.placeholders so the slot stays visible and re-fillable.
 *
 * The picker/swap routes also exclude status = 'JUNK' so a junked question
 * can never re-appear.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { question_id, reason } = body;
    if (!question_id) return NextResponse.json({ error: 'question_id required' }, { status: 400 });

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Slot lookup
        const slotRes = await client.query(`
            SELECT mtq.position, mtq.exam_section_id, mtq.slot_subtype, mtq.slot_difficulty, mtq.group_id,
                   qv.subtype, qv.difficulty, qv.meta_json
            FROM mock_test_question mtq
            JOIN question_version qv ON qv.question_id = mtq.question_id AND qv.language='EN'
            WHERE mtq.mock_test_id = $1 AND mtq.question_id = $2
        `, [mockTestId, question_id]);
        if (slotRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Question not in this mock' }, { status: 404 });
        }
        const slot = slotRes.rows[0];
        const sectionCode = TARGET_TO_CODE[slot.exam_section_id];
        const bankSectionId = TARGET_TO_BANK[slot.exam_section_id];

        // 1) Mark JUNK + audit
        const meta = slot.meta_json || {};
        const history = Array.isArray(meta.edit_history) ? meta.edit_history : [];
        history.push({
            action: 'junk',
            reason: reason || null,
            by: user.id,
            by_name: user.name || user.email || null,
            at: new Date().toISOString(),
            mock_test_id: mockTestId,
        });
        await client.query(`
            UPDATE question_version
            SET status = 'JUNK',
                meta_json = $1::jsonb,
                updated_at = NOW()
            WHERE question_id = $2 AND language = 'EN'
        `, [JSON.stringify({ ...meta, edit_history: history }), question_id]);

        // 2) Decide replacement strategy: grouped → leave a placeholder; else try a swap.
        if (slot.group_id) {
            // For grouped slots, remove the whole group from the mock and
            // restore a placeholder per missing slot — full group swap is the
            // existing /swap route's responsibility, not junk's.
            const groupRows = await client.query(`
                SELECT position FROM mock_test_question
                WHERE mock_test_id = $1 AND group_id = $2
                ORDER BY position
            `, [mockTestId, slot.group_id]);
            await client.query(`DELETE FROM mock_test_question WHERE mock_test_id = $1 AND group_id = $2`,
                [mockTestId, slot.group_id]);
            await appendPlaceholders(client, mockTestId, sectionCode, groupRows.rows.map(r => r.position));
            await client.query('COMMIT');
            return NextResponse.json({ success: true, action: 'junked_group_to_placeholder', positions: groupRows.rows.map(r => r.position) });
        }

        // Exclusion set for swap candidates (all CGL T1 mocks, any status)
        const exclRes = await client.query(`
            SELECT DISTINCT mtq.question_id
            FROM mock_test_question mtq
            JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
            WHERE mt.exam_id = $1
        `, [CGL_T1_EXAM_ID]);
        const excluded = new Set(exclRes.rows.map(r => r.question_id));

        const prefixSeed = slot.slot_subtype || (slot.subtype ? slot.subtype.split('_')[0] : null);
        let replacement = null;
        if (prefixSeed && bankSectionId) {
            const candRes = await client.query(`
                SELECT qv.question_id, qv.subtype, qv.difficulty
                FROM question_version qv
                WHERE qv.source_type='bank' AND qv.question_type='MCQ' AND qv.language='EN'
                  AND qv.solution_status='DONE'
                  AND qv.correct_option_label IS NOT NULL
                  AND COALESCE(qv.status, '') != 'JUNK'
                  AND qv.exam_section_id = $1
                  AND qv.difficulty = $2
                  AND qv.subtype LIKE $3
                  AND qv.group_id IS NULL
                LIMIT 200
            `, [bankSectionId, slot.difficulty, `${prefixSeed}%`]);
            const fresh = candRes.rows.filter(r => !excluded.has(r.question_id) && r.question_id !== question_id);
            const differentVariation = fresh.filter(r => r.subtype !== slot.subtype);
            const pool = differentVariation.length > 0 ? differentVariation : fresh;
            if (pool.length > 0) replacement = pool[Math.floor(Math.random() * pool.length)];
        }

        if (replacement) {
            await client.query(
                `DELETE FROM mock_test_question WHERE mock_test_id = $1 AND question_id = $2`,
                [mockTestId, question_id]
            );
            await client.query(`
                INSERT INTO mock_test_question
                  (mock_test_id, question_id, exam_section_id, position,
                   slot_subtype, slot_difficulty, group_id, review_status, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, NULL, 'PENDING', NOW())
            `, [
                mockTestId, replacement.question_id, slot.exam_section_id, slot.position,
                slot.slot_subtype, slot.slot_difficulty,
            ]);
            await client.query('COMMIT');
            return NextResponse.json({
                success: true,
                action: 'junked_and_swapped',
                old_question_id: question_id,
                new_question_id: replacement.question_id,
                new_subtype: replacement.subtype,
                new_difficulty: replacement.difficulty,
            });
        }

        // No replacement found: delete the row and add a placeholder back.
        await client.query(
            `DELETE FROM mock_test_question WHERE mock_test_id = $1 AND question_id = $2`,
            [mockTestId, question_id]
        );
        await appendPlaceholders(client, mockTestId, sectionCode, [slot.position]);
        await client.query('COMMIT');
        return NextResponse.json({
            success: true,
            action: 'junked_to_placeholder',
            position: slot.position,
            note: 'No fresh replacement available — slot returned to placeholder.',
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('cgl-mock/junk error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}

// Per-section placeholder prefix. REASONING keeps its legacy IMG name; GA's
// legacy CA name is kept ONLY for GA (it implies a CA editor modal). For QUANT
// and ENGLISH we used to misroute through GA_CA, which made the UI offer
// "Add CA question" for a junked Quant DI slot — nonsense.
const PH_PREFIX_BY_SECTION = {
    REASONING: 'PLACEHOLDER_REAS_IMG_JUNK',
    GA:        'PLACEHOLDER_GA_CA_JUNK',
    QUANT:     'PLACEHOLDER_QUANT_JUNK',
    ENGLISH:   'PLACEHOLDER_ENG_JUNK',
};

async function appendPlaceholders(client, mockTestId, sectionCode, positions) {
    if (positions.length === 0) return;
    const mtRes = await client.query(
        `SELECT stats_json FROM mock_test WHERE mock_test_id = $1 FOR UPDATE`,
        [mockTestId]
    );
    const stats = mtRes.rows[0]?.stats_json || {};
    const existing = Array.isArray(stats.placeholders) ? stats.placeholders : [];
    const phPrefix = PH_PREFIX_BY_SECTION[sectionCode] || `PLACEHOLDER_${sectionCode}_JUNK`;
    let counter = existing
        .filter(p => p.placeholder_id?.startsWith(phPrefix))
        .map(p => parseInt((p.placeholder_id.match(/_(\d+)$/) || [])[1] || '0', 10))
        .reduce((m, n) => Math.max(m, n), 0);
    const newOnes = positions.map(pos => ({
        section_code: sectionCode,
        position: pos,
        placeholder_id: `${phPrefix}_${++counter}`,
    }));
    const next = { ...stats, placeholders: [...existing, ...newOnes] };
    await client.query(
        `UPDATE mock_test SET stats_json = $1::jsonb, updated_at = NOW() WHERE mock_test_id = $2`,
        [JSON.stringify(next), mockTestId]
    );
}
