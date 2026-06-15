import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { getSpec } from '@/lib/mock-spec-resolver';
import { buildMock } from '@/lib/cgl-mock-picker';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/**
 * POST /api/cgl-mock/generate
 *
 * Single mock (legacy):
 *   { examKey?, ...config, name?, plan?: { bank_subtype_targets }, difficulty_profile? }
 *
 * Batch mocks (new):
 *   {
 *     examKey?, ...config, difficulty_profile?,
 *     mocks: [
 *       { plan: { bank_subtype_targets }, name? },
 *       { plan: { bank_subtype_targets }, name? },
 *       { plan: { bank_subtype_targets }, name? },
 *     ]
 *   }
 *
 * All N mocks are generated inside a single transaction. The exclusion set
 * grows after each pick so question_ids never duplicate across the batch
 * (cross-mock dedup is enforced even when the soft "minimize subtype overlap"
 * plan can't fully separate variations).
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch { body = {}; }
    const SPEC = getSpec(body?.examKey);
    const {
        TARGET_SECTION_IDS, BANK_SECTION_IDS, SECTION_CODES, ALLOWED_SOURCE_TYPES,
        normalizeConfig, normalizeDifficultyProfile,
    } = SPEC;
    const config = normalizeConfig(body);

    // Normalize input: either legacy `plan` + `name` or new `mocks: [...]`.
    const requestedName = (body.name || '').trim();
    const mocksInput = Array.isArray(body?.mocks) && body.mocks.length > 0
        ? body.mocks
        : [{ plan: body?.plan || null, name: requestedName || null }];

    if (mocksInput.length > 10) {
        return NextResponse.json({ error: 'mocks[] capped at 10 per request' }, { status: 400 });
    }

    const { profile: difficultyProfile, errors: profileErrors } =
        normalizeDifficultyProfile(body?.difficulty_profile, config);
    if (profileErrors.length > 0) {
        return NextResponse.json({ error: profileErrors.join(' ') }, { status: 400 });
    }

    const client = await db.connect();
    try {
        // 1) Exclusion set: every question_id ever used in a mock of this exam.
        const exclRes = await client.query(`
            SELECT DISTINCT mtq.question_id
            FROM mock_test_question mtq
            JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
            WHERE mt.exam_id = $1
        `, [SPEC.examId]);
        const excludedIds = new Set(exclRes.rows.map(r => r.question_id));

        // 2) Pool — verified bank+pyq questions per bank section. Pre-fetched once
        // and shared across all N picker passes; the picker enforces exclusion in-memory.
        const bankSectionIds = SECTION_CODES.map(c => BANK_SECTION_IDS[c]);
        const now = new Date();
        const currentYq = now.getFullYear() * 4 + (Math.floor(now.getMonth() / 3) + 1);
        const caCutoffYq = currentYq - (config.ca_freshness_quarters || 4);
        const poolRes = await client.query(`
            SELECT qv.question_id, qv.exam_section_id, qv.subtype, qv.difficulty,
                   qv.leaf_topic_id, qv.group_id, qv.group_order,
                   qv.correct_option_label,
                   qv.body_json,
                   qv.source_type,
                   (qv.meta_json->>'variation') AS variation
            FROM question_version qv
            WHERE qv.source_type = ANY($3)
              AND qv.question_type = 'MCQ'
              AND qv.language = 'EN'
              AND qv.solution_status = 'DONE'
              AND qv.correct_option_label IS NOT NULL
              AND COALESCE((qv.meta_json->'resolve'->>'match')::boolean, true) = true
              AND COALESCE(qv.status, '') != 'JUNK'
              AND qv.exam_section_id = ANY($1)
              AND qv.difficulty IN (1, 2, 3, 4)
              AND (
                qv.subtype NOT LIKE 'ca\\_%' ESCAPE '\\'
                OR qv.source_type != 'bank'
                OR (
                    (qv.meta_json->>'relevance_year')::int * 4
                    + (qv.meta_json->>'relevance_quarter')::int >= $2
                )
              )
        `, [bankSectionIds, caCutoffYq, ALLOWED_SOURCE_TYPES]);

        const byBankSectionId = Object.fromEntries(
            SECTION_CODES.map(c => [BANK_SECTION_IDS[c], c])
        );
        const poolsBySection = Object.fromEntries(SECTION_CODES.map(c => [c, []]));
        for (const row of poolRes.rows) {
            const code = byBankSectionId[row.exam_section_id];
            if (code) poolsBySection[code].push(row);
        }

        // 3) Groups (RC/CLOZE/DI etc.) — same fetch.
        const grpRes = await client.query(`
            SELECT qg.group_id, qg.group_type, qg.passage_question_id,
                   qg.exam_section_id,
                   COALESCE(LENGTH(pv.body_json->>'text'), 0) AS passage_chars,
                   qv.question_id, qv.group_order, qv.difficulty, qv.subtype,
                   qv.leaf_topic_id, qv.correct_option_label, qv.body_json,
                   qv.solution_status, qv.meta_json
            FROM question_group qg
            JOIN question_version qv
              ON qv.group_id = qg.group_id
             AND qv.language = 'EN'
             AND qv.question_type = 'MCQ'
             AND qv.source_type = 'bank'
            LEFT JOIN question_version pv
              ON pv.question_id = qg.passage_question_id
             AND pv.language = 'EN'
            WHERE qg.exam_section_id = ANY($1)
              AND qv.solution_status = 'DONE'
              AND qv.correct_option_label IS NOT NULL
              AND COALESCE(qv.status, '') != 'JUNK'
              AND qv.difficulty IN (1, 2, 3, 4)
            ORDER BY qg.group_id, qv.group_order NULLS LAST
        `, [bankSectionIds]);

        const groupsMap = new Map();
        for (const row of grpRes.rows) {
            if (!groupsMap.has(row.group_id)) {
                groupsMap.set(row.group_id, {
                    group_id: row.group_id,
                    group_type: row.group_type,
                    passage_question_id: row.passage_question_id,
                    passage_chars: row.passage_chars ?? 0,
                    section_code: byBankSectionId[row.exam_section_id],
                    members: [],
                });
            }
            groupsMap.get(row.group_id).members.push({
                question_id: row.question_id,
                group_order: row.group_order,
                difficulty: row.difficulty,
                subtype: row.subtype,
                leaf_topic_id: row.leaf_topic_id,
                correct_option_label: row.correct_option_label,
            });
        }
        const groups = [...groupsMap.values()];

        // 4) Pre-fetch the visual-PYQ pool ONCE for placeholder fills. We dedupe
        // in-memory across the batch instead of re-running the query per mock.
        const visRes = await client.query(`
            SELECT qv.question_id, qv.subtype, qv.difficulty
            FROM question_version qv
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE qv.paper_session_id IS NOT NULL
              AND qv.language = 'EN'
              AND qv.question_type = 'MCQ'
              AND qv.correct_option_label IS NOT NULL
              AND COALESCE(qv.status, '') != 'JUNK'
              AND qv.has_image = true
              AND es.code IN ('REASONING', 'GIR', 'GI')
              AND NOT EXISTS (
                  SELECT 1 FROM mock_test_question mtq2
                  JOIN mock_test mt ON mt.mock_test_id = mtq2.mock_test_id
                  WHERE mtq2.question_id = qv.question_id AND mt.exam_id = $1
              )
            ORDER BY qv.subtype, qv.difficulty
        `, [SPEC.examId]);
        const visualPoolBySubtype = new Map();
        for (const r of visRes.rows) {
            const k = r.subtype || 'unknown';
            if (!visualPoolBySubtype.has(k)) visualPoolBySubtype.set(k, []);
            visualPoolBySubtype.get(k).push(r);
        }
        // Stable order within each subtype.
        for (const arr of visualPoolBySubtype.values()) {
            arr.sort((a, b) => (a.question_id < b.question_id ? -1 : 1));
        }
        const visualSubtypeOrder = [...visualPoolBySubtype.keys()];

        await client.query('BEGIN');

        const created = [];
        const totalN = mocksInput.length;
        const batchTs = Date.now().toString(36);
        const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');

        for (let i = 0; i < mocksInput.length; i++) {
            const mockSpec = mocksInput[i] || {};
            const userBankTargets = mockSpec?.plan?.bank_subtype_targets || null;

            const picker = buildMock({
                examKey: SPEC.examKey,
                config,
                poolsBySection,
                groups,
                excludedIds,
                userBankTargets,
                difficultyProfile,
            });

            const baseName = (mockSpec?.name || '').trim()
                || (totalN > 1
                    ? `${SPEC.displayName} Mock — ${nowIso} (${i + 1} of ${totalN})`
                    : `${SPEC.displayName} Mock — ${nowIso}`);
            const slug = totalN > 1
                ? `${SPEC.slug}-${batchTs}-${i + 1}`
                : `${SPEC.slug}-${batchTs}`;

            const mockRes = await client.query(`
                INSERT INTO mock_test
                  (exam_id, name, slug, status, type, stats_json, created_by, created_at, updated_at)
                VALUES ($1, $2, $3, 'DRAFT', 'MOCK', $4, $5, NOW(), NOW())
                RETURNING mock_test_id
            `, [
                SPEC.examId,
                baseName,
                slug,
                JSON.stringify({
                    builder: SPEC.builderTag,
                    examKey: SPEC.examKey,
                    config: picker.config,
                    placeholders: picker.placeholders,
                    section_stats: picker.section_stats,
                    notes: picker.notes,
                    user_bank_targets: userBankTargets || null,
                    difficulty_profile: picker.difficulty_profile,
                    generated_at: new Date().toISOString(),
                    generated_by: user.id,
                    batch_index: totalN > 1 ? (i + 1) : null,
                    batch_size:  totalN > 1 ? totalN : null,
                }),
                user.id,
            ]);
            const mockTestId = mockRes.rows[0].mock_test_id;

            for (const item of picker.items) {
                await client.query(`
                    INSERT INTO mock_test_question
                      (mock_test_id, question_id, exam_section_id, position,
                       slot_subtype, slot_difficulty, group_id, review_status, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', NOW())
                `, [
                    mockTestId,
                    item.question_id,
                    TARGET_SECTION_IDS[item.section_code],
                    item.position,
                    item.slot_subtype,
                    item.slot_difficulty != null ? String(item.slot_difficulty) : null,
                    item.group_id,
                ]);
                excludedIds.add(item.question_id);
            }

            // Auto-fill REASONING image placeholders from the visual-PYQ pool
            // we pre-fetched. Pool is shared across the batch; each pick adds to
            // excludedIds so later mocks see fresh visuals.
            const reasoningPlaceholders = (picker.placeholders || [])
                .filter(p => p.section_code === 'REASONING'
                    && p.placeholder_id?.startsWith('PLACEHOLDER_REAS_IMG'))
                .sort((a, b) => (a.position || 0) - (b.position || 0));

            const visualFills = [];
            const visualErrors = [];
            if (reasoningPlaceholders.length > 0) {
                const picked = [];
                const want = reasoningPlaceholders.length;
                while (picked.length < want) {
                    let progressed = false;
                    for (const s of visualSubtypeOrder) {
                        if (picked.length >= want) break;
                        const bucket = visualPoolBySubtype.get(s);
                        if (!bucket || bucket.length === 0) continue;
                        // Skip rows already excluded (consumed by prior batch member).
                        while (bucket.length > 0 && excludedIds.has(bucket[0].question_id)) {
                            bucket.shift();
                        }
                        if (bucket.length === 0) continue;
                        picked.push(bucket.shift());
                        progressed = true;
                    }
                    if (!progressed) break;
                }

                const filledPositions = new Set();
                for (let j = 0; j < picked.length; j++) {
                    const ph = reasoningPlaceholders[j];
                    const q = picked[j];
                    await client.query(`
                        INSERT INTO mock_test_question
                          (mock_test_id, question_id, exam_section_id, position,
                           slot_subtype, slot_difficulty, group_id, review_status, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, NULL, 'PENDING', NOW())
                    `, [
                        mockTestId,
                        q.question_id,
                        TARGET_SECTION_IDS.REASONING,
                        ph.position,
                        'visual_reasoning',
                        q.difficulty != null ? String(q.difficulty) : null,
                    ]);
                    visualFills.push({
                        position: ph.position,
                        placeholder_id: ph.placeholder_id,
                        question_id: q.question_id,
                        subtype: q.subtype,
                        difficulty: q.difficulty,
                    });
                    filledPositions.add(ph.position);
                    excludedIds.add(q.question_id);
                }

                const remaining = picker.placeholders.filter(p => !filledPositions.has(p.position));
                if (remaining.length !== picker.placeholders.length) {
                    await client.query(`
                        UPDATE mock_test
                        SET stats_json = jsonb_set(
                            jsonb_set(stats_json, '{placeholders}', $1::jsonb, true),
                            '{auto_filled_visuals}', $2::jsonb, true
                        ),
                        updated_at = NOW()
                        WHERE mock_test_id = $3
                    `, [JSON.stringify(remaining), JSON.stringify(visualFills), mockTestId]);
                }
                if (picked.length < want) {
                    visualErrors.push(`Mock ${i + 1}: filled ${picked.length}/${want} visual placeholders; PYQ pool exhausted for the rest.`);
                }
            }

            created.push({
                mock_test_id: mockTestId,
                name: baseName,
                section_stats: picker.section_stats,
                placeholders: picker.placeholders,
                notes: [...picker.notes, ...visualErrors],
                auto_filled_visuals: visualFills,
            });
        }

        await client.query('COMMIT');

        // Backward-compatible response shape: when a single mock is requested,
        // surface the legacy top-level fields too. The batch case adds `mocks: [...]`.
        if (created.length === 1) {
            return NextResponse.json({
                success: true,
                mock_test_id: created[0].mock_test_id,
                name: created[0].name,
                section_stats: created[0].section_stats,
                placeholders: created[0].placeholders,
                notes: created[0].notes,
                auto_filled_visuals: created[0].auto_filled_visuals,
                mocks: created,
            });
        }
        return NextResponse.json({ success: true, mocks: created });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('cgl-mock/generate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
