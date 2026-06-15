import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { getSpec } from '@/lib/mock-spec-resolver';
import { buildMock } from '@/lib/cgl-mock-picker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/cgl-mock/generate
 * Body: MOCK CONFIGURATION + optional `name`.
 * Generates a DRAFT SSC CGL Tier 1 mock from the verified bank pool,
 * excluding question_ids used in any prior CGL T1 mock_test (any status).
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
    const requestedName = (body.name || '').trim();

    // Optional user-provided plan: { bank_subtype_targets: { REASONING: {bank_subtype: N, ...}, ... } }
    // When present, the picker uses these counts directly instead of SECTION_SPEC.targets.
    const userBankTargets = body?.plan?.bank_subtype_targets || null;

    // Optional per-mock difficulty profile. Falls back to SECTION_DIFFICULTY_BASE.
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

        // 2) Pool — verified bank questions per bank section.
        // For CA questions (subtype ca_%), additional freshness filter: the question's
        // relevance_year * 4 + relevance_quarter must be >= cutoff (current YQ - freshness_quarters).
        const bankSectionIds = SECTION_CODES.map(c => BANK_SECTION_IDS[c]);
        const now = new Date();
        const currentYq = now.getFullYear() * 4 + (Math.floor(now.getMonth() / 3) + 1);
        const caCutoffYq = currentYq - (config.ca_freshness_quarters || 4);
        // Pool: CHSL bank + CHSL PYQ (source_type IN ('bank', 'pyq')). Same quality
        // bar for both: solution_status='DONE', has answer key, not JUNK. CA freshness
        // applies only to CHSL-bank ca_* subtypes (PYQ ca rows don't carry
        // relevance_year/quarter). Group-bound questions remain bank-only — the
        // picker's group join below stays unchanged.
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

        // 3) Groups: load full membership for any group_id present in the pool
        //    plus their stimulus question_id.
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

        // 4) Run the picker.
        const picker = buildMock({
            examKey: SPEC.examKey,
            config,
            poolsBySection,
            groups,
            excludedIds,
            userBankTargets,
            difficultyProfile,
        });

        // 5) Persist: mock_test + mock_test_question.
        const name = requestedName ||
            `${SPEC.displayName} Mock — ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
        const slug = `${SPEC.slug}-${Date.now().toString(36)}`;

        await client.query('BEGIN');

        const mockRes = await client.query(`
            INSERT INTO mock_test
              (exam_id, name, slug, status, type, stats_json, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, 'DRAFT', 'MOCK', $4, $5, NOW(), NOW())
            RETURNING mock_test_id
        `, [
            SPEC.examId,
            name,
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
        }

        // 6) Auto-fill REASONING image placeholders from the PYQ visual-reasoning pool.
        // Subtype-varied: round-robin across distinct visual subtypes (cube_dice,
        // mirror_image, paper_folding, figure_series, embedded_figure, …) so the 5
        // visual slots cover ≥4 subtypes by default. Excludes anything already in
        // any CGL T1 mock — including questions the picker itself just inserted.
        const reasoningPlaceholders = (picker.placeholders || [])
            .filter(p => p.section_code === 'REASONING' && p.placeholder_id?.startsWith('PLACEHOLDER_REAS_IMG'))
            .sort((a, b) => (a.position || 0) - (b.position || 0));

        const visualFills = [];
        const visualErrors = [];
        if (reasoningPlaceholders.length > 0) {
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

            // Bucket by subtype, then round-robin pick — 1 per subtype per pass.
            const bySubtype = {};
            for (const r of visRes.rows) {
                const k = r.subtype || 'unknown';
                if (!bySubtype[k]) bySubtype[k] = [];
                bySubtype[k].push(r);
            }
            // Shuffle subtype order so we don't always lead with 'cube_dice'
            const subtypeOrder = Object.keys(bySubtype).sort(() => 0.5 - ((mockTestId.charCodeAt(0) % 7) / 7));
            // Shuffle within each subtype too (lightweight, seeded by mockTestId)
            for (const k of subtypeOrder) {
                bySubtype[k].sort((a, b) => (a.question_id < b.question_id ? -1 : 1));
            }
            const picked = [];
            const want = reasoningPlaceholders.length;
            while (picked.length < want) {
                let progressed = false;
                for (const s of subtypeOrder) {
                    if (picked.length >= want) break;
                    if (bySubtype[s].length === 0) continue;
                    picked.push(bySubtype[s].shift());
                    progressed = true;
                }
                if (!progressed) break;
            }

            const filledPositions = new Set();
            for (let i = 0; i < picked.length; i++) {
                const ph = reasoningPlaceholders[i];
                const q = picked[i];
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
            }

            // Any placeholders we couldn't fill stay in stats_json.placeholders
            // so the reviewer can still pick manually.
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
                visualErrors.push(`Filled ${picked.length}/${want} visual placeholders; PYQ pool exhausted for the rest.`);
            }
        }

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            mock_test_id: mockTestId,
            name,
            section_stats: picker.section_stats,
            placeholders: picker.placeholders,
            notes: [...picker.notes, ...visualErrors],
            auto_filled_visuals: visualFills,
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('cgl-mock/generate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
