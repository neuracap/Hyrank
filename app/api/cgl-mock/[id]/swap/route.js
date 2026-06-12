import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import {
    CGL_T1_EXAM_ID, TARGET_SECTION_IDS, BANK_SECTION_IDS, SECTION_CODES,
    SUBTYPE_PREFIXES, SECTION_SPEC,
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

    // Optional source filter: 'bank' | 'pyq' | null. When set, the single-question
    // swap restricts candidates to that source_type — used by the "Swap (PYQ)"
    // button to bring in a same-subtype PYQ replacement. Group swap ignores this.
    const preferSource = body?.prefer_source;
    if (preferSource != null && !['bank', 'pyq'].includes(preferSource)) {
        return NextResponse.json({ error: 'prefer_source must be "bank" or "pyq"' }, { status: 400 });
    }

    // Optional cap on passage length for group swaps (RC passages get long; for CGL T1
    // the reviewer often wants a tighter passage). Applied only to grouped slots whose
    // group_type carries a passage (RC, CLOZE). Ignored for single-question swaps.
    let maxPassageChars = null;
    if (body.max_passage_chars != null && body.max_passage_chars !== '') {
        const n = parseInt(body.max_passage_chars, 10);
        if (!Number.isInteger(n) || n < 100 || n > 5000) {
            return NextResponse.json({ error: 'max_passage_chars must be an integer in [100, 5000]' }, { status: 400 });
        }
        maxPassageChars = n;
    }

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

            const oldGroupType = (await client.query(`SELECT group_type FROM question_group WHERE group_id=$1`, [slot.group_id])).rows[0]?.group_type;

            // Spec target size for this group type (CGL T1: 5 for RC/CLOZE/DI).
            // Used to (a) shrink existing over-large groups during swap, and
            // (b) ensure the new group inserts exactly this many even if the
            // bank group has more bank members.
            const groupSpec = (SECTION_SPEC[sectionCode]?.groups || [])
                .find(g => g.group_type === oldGroupType);
            const targetSize = groupSpec?.expected_size_max || oldSize;

            // Find candidate replacement groups (same group_type) with enough members and none excluded.
            // Joins question_version pv to pull the passage stimulus length, so callers can cap by passage size.
            const grpRes = await client.query(`
                SELECT qg.group_id, qg.group_type,
                       array_agg(qv.question_id ORDER BY qv.group_order NULLS LAST) AS member_ids,
                       array_agg(qv.difficulty   ORDER BY qv.group_order NULLS LAST) AS difficulties,
                       COALESCE(LENGTH(MAX(pv.body_json->>'text')), 0) AS passage_chars
                FROM question_group qg
                JOIN question_version qv ON qv.group_id = qg.group_id AND qv.language='EN' AND qv.question_type='MCQ' AND qv.source_type='bank'
                LEFT JOIN question_version pv ON pv.question_id = qg.passage_question_id AND pv.language='EN'
                WHERE qg.exam_section_id = $1
                  AND qv.solution_status = 'DONE'
                  AND qv.correct_option_label IS NOT NULL
                  AND COALESCE(qv.status, '') != 'JUNK'
                  AND qv.difficulty IN (1,2,3,4)
                  AND qg.group_id != $2
                GROUP BY qg.group_id, qg.group_type
                HAVING qg.group_type = $3
            `, [bankSectionId, slot.group_id, oldGroupType]);

            // Filter: every member fresh, and group has AT LEAST targetSize members.
            // Bank groups range from 5 to 17 members (RC pool); the test slot should
            // carry exactly `targetSize` per the spec — so we'll insert just the
            // first `targetSize` ordered members. Pre-fix this filter was `=== oldSize`,
            // which (a) rejected the 232 RC groups with >5 members and (b) preserved
            // the picker bug that inserted all 14 bank members of an over-large group.
            let usable = grpRes.rows.filter(g =>
                g.member_ids.length >= targetSize && g.member_ids.every(mid => !excluded.has(mid))
            );

            // If the caller asked for a passage length cap (RC/CLOZE only carry passages),
            // filter to groups whose passage fits. Fail loudly rather than silently picking
            // a too-long passage.
            if (maxPassageChars != null && (oldGroupType === 'RC' || oldGroupType === 'CLOZE')) {
                const withinCap = usable.filter(g => (g.passage_chars ?? 0) <= maxPassageChars);
                if (withinCap.length === 0) {
                    await client.query('ROLLBACK');
                    return NextResponse.json({
                        error: `No fresh ${oldGroupType} group with passage ≤ ${maxPassageChars} chars. Try raising the limit.`,
                    }, { status: 409 });
                }
                usable = withinCap;
            }

            if (usable.length === 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'No replacement group available with the same size and fresh members.' }, { status: 409 });
            }
            const pick = usable[Math.floor(Math.random() * usable.length)];

            // Delete old, insert new at the first `targetSize` positions. If the
            // existing slot was over-large (picker bug, oldSize > targetSize), this
            // shrinks it to spec on swap — the extra positions become free slots
            // in the section (caller can re-generate or accept the shrink).
            await client.query(`
                DELETE FROM mock_test_question WHERE mock_test_id = $1 AND group_id = $2
            `, [mockTestId, slot.group_id]);

            // If the spec declares a target composition (RC: 3 L2 + 2 L3), extract
            // that subset from the new group's members instead of taking the first
            // `targetSize` by order. Greedy: fill each target level up to its want,
            // pad shortfall preferring L2 → L3 → L1 → L4.
            const preferComp = groupSpec?.prefer_composition || null;
            const insertCount = Math.min(pick.member_ids.length, targetSize);
            const insertMembers = pickMembersByComposition(
                pick.member_ids, pick.difficulties, insertCount, preferComp,
            );

            for (let i = 0; i < insertMembers.length; i++) {
                const m = insertMembers[i];
                await client.query(`
                    INSERT INTO mock_test_question
                      (mock_test_id, question_id, exam_section_id, position,
                       slot_subtype, slot_difficulty, group_id, review_status, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', NOW())
                `, [
                    mockTestId,
                    m.question_id,
                    slot.exam_section_id,
                    oldPositions[i],
                    pick.group_type,
                    m.difficulty != null ? String(m.difficulty) : null,
                    pick.group_id,
                ]);
            }
            await client.query('COMMIT');
            return NextResponse.json({
                success: true,
                swapped: 'group',
                old_group_id: slot.group_id,
                new_group_id: pick.group_id,
                size: insertCount,
                old_size: oldSize,
                bank_group_size: pick.member_ids.length,
                shrunk: oldSize > insertCount,
                passage_chars: pick.passage_chars ?? null,
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

        // If a source filter was passed, restrict to it; otherwise allow both bank and PYQ.
        // PYQs additionally require paper_session_id (the marker the search-pyq route uses too).
        const sourceTypes = preferSource ? [preferSource] : ['bank', 'pyq'];
        const candRes = await client.query(`
            SELECT qv.question_id, qv.subtype, qv.difficulty, qv.leaf_topic_id,
                   qv.correct_option_label, qv.source_type
            FROM question_version qv
            WHERE qv.source_type = ANY($4) AND qv.question_type = 'MCQ' AND qv.language = 'EN'
              AND qv.solution_status = 'DONE'
              AND qv.correct_option_label IS NOT NULL
              AND COALESCE(qv.status, '') != 'JUNK'
              AND qv.exam_section_id = $1
              AND qv.difficulty = $2
              AND qv.subtype LIKE ANY($3)
              AND qv.group_id IS NULL
            LIMIT 200
        `, [bankSectionId, effectiveDifficulty, likePatterns, sourceTypes]);

        const fresh = candRes.rows.filter(r => !excluded.has(r.question_id));
        if (fresh.length === 0) {
            await client.query('ROLLBACK');
            const sourceLabel = preferSource ? ` (source=${preferSource})` : '';
            return NextResponse.json({
                error: `No fresh replacement${sourceLabel} for spec_subtype="${effectiveSpecSubtype}" at difficulty L${effectiveDifficulty}.`,
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
            new_source: pick.source_type || 'bank',
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('cgl-mock/swap error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}

/**
 * Pick `n` members from the (memberIds, difficulties) parallel arrays whose
 * level mix is as close to `target` as possible. Mirror of
 * `pickSubsetByTarget` in lib/cgl-mock-picker.js (kept inline to avoid an
 * import cycle through DB-dependent code). Returns { question_id, difficulty }
 * in the original order so callers can pair them with `oldPositions`.
 *
 * If `target` is null, falls back to first-N (preserving group_order via input).
 */
function pickMembersByComposition(memberIds, difficulties, n, target) {
    const all = memberIds.map((qid, i) => ({
        idx: i,
        question_id: qid,
        difficulty: difficulties[i],
    }));
    if (!target) return all.slice(0, n);

    const byLvl = { 1: [], 2: [], 3: [], 4: [] };
    for (const m of all) {
        if (byLvl[m.difficulty]) byLvl[m.difficulty].push(m);
    }
    const picked = [];
    for (const lvl of [1, 2, 3, 4]) {
        const want = target[`L${lvl}`] || 0;
        if (want <= 0) continue;
        picked.push(...byLvl[lvl].splice(0, want));
    }
    if (picked.length < n) {
        for (const lvl of [2, 3, 1, 4]) {     // pad: L2 → L3 → L1 → L4
            while (picked.length < n && byLvl[lvl].length > 0) {
                picked.push(byLvl[lvl].shift());
            }
        }
    }
    return picked.slice(0, n).sort((a, b) => a.idx - b.idx);
}
