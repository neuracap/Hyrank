import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import {
    CGL_T1_EXAM_ID, BANK_SECTION_IDS, SECTION_CODES, SECTION_TOTAL,
    SECTION_SPEC, SUBTYPE_PREFIXES, SECTION_DIFFICULTY_BASE,
    normalizeConfig, buildPlaceholderTemplates, placeholderCountsBySection,
} from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/cgl-mock/preview
 *
 * Body: the 5 MOCK CONFIGURATION inputs.
 * Returns: per section, every verified bank subtype with its current
 * available pool count (excluding anything in any CGL T1 mock), grouped by
 * the derived spec-slug. Also returns a `suggested_plan` keyed by section →
 * { bank_subtype: count } built from the spec targets and distributed across
 * the largest-pool variations within each spec-subtype.
 *
 * The frontend uses this to render the planning step where the user adjusts
 * fine-grained counts before generation.
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch { body = {}; }
    const config = normalizeConfig(body);

    const client = await db.connect();
    try {
        const bankSectionIds = SECTION_CODES.map(c => BANK_SECTION_IDS[c]);

        // 1. Pool depths per (section, bank_subtype, difficulty)
        const poolRes = await client.query(`
            SELECT qv.exam_section_id, qv.subtype, qv.difficulty, COUNT(*)::int AS c
            FROM question_version qv
            WHERE qv.source_type='bank' AND qv.question_type='MCQ' AND qv.language='EN'
              AND qv.solution_status='DONE' AND qv.correct_option_label IS NOT NULL
              AND COALESCE(qv.status,'') != 'JUNK'
              AND COALESCE((qv.meta_json->'resolve'->>'match')::boolean, true) = true
              AND qv.exam_section_id = ANY($1)
              AND qv.difficulty IN (1,2,3,4)
              AND NOT EXISTS (
                  SELECT 1 FROM mock_test_question mtq
                  JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
                  WHERE mtq.question_id = qv.question_id AND mt.exam_id = $2
              )
            GROUP BY qv.exam_section_id, qv.subtype, qv.difficulty
            ORDER BY qv.exam_section_id, COUNT(*) DESC
        `, [bankSectionIds, CGL_T1_EXAM_ID]);

        // 2. Available groups (RC/Cloze/DI) per section + size + passage length
        // Passage text lives on a question_version row referenced by qg.passage_question_id.
        const grpRes = await client.query(`
            SELECT qg.exam_section_id, qg.group_id, qg.group_type,
                   COUNT(qv.question_id)::int AS size,
                   COALESCE(LENGTH(MAX(pv.body_json->>'text')), 0) AS passage_chars
            FROM question_group qg
            JOIN question_version qv ON qv.group_id = qg.group_id AND qv.language='EN' AND qv.question_type='MCQ' AND qv.source_type='bank'
            LEFT JOIN question_version pv ON pv.question_id = qg.passage_question_id AND pv.language='EN'
            WHERE qg.exam_section_id = ANY($1)
              AND qv.solution_status='DONE' AND qv.correct_option_label IS NOT NULL
              AND COALESCE(qv.status,'') != 'JUNK'
              AND qv.difficulty IN (1,2,3,4)
              AND NOT EXISTS (
                  SELECT 1 FROM mock_test_question mtq
                  JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
                  WHERE mtq.question_id = qv.question_id AND mt.exam_id = $2
              )
            GROUP BY qg.exam_section_id, qg.group_id, qg.group_type
        `, [bankSectionIds, CGL_T1_EXAM_ID]);

        // Inversion: bank_section_id -> code
        const codeByBankId = Object.fromEntries(SECTION_CODES.map(c => [BANK_SECTION_IDS[c], c]));

        // Aggregate
        const sections = SECTION_CODES.map(code => {
            const bankId = BANK_SECTION_IDS[code];
            const rowsHere = poolRes.rows.filter(r => r.exam_section_id === bankId);
            // bank_subtype → { pool, L1, L2, L3, L4 }
            const bankPool = new Map();
            for (const row of rowsHere) {
                if (!bankPool.has(row.subtype)) {
                    bankPool.set(row.subtype, { bank_subtype: row.subtype, pool: 0, L1: 0, L2: 0, L3: 0, L4: 0 });
                }
                const e = bankPool.get(row.subtype);
                e.pool += row.c;
                if (row.difficulty === 1) e.L1 += row.c;
                else if (row.difficulty === 2) e.L2 += row.c;
                else if (row.difficulty === 3) e.L3 += row.c;
                else if (row.difficulty === 4) e.L4 += row.c;
            }

            // Group bank subtypes by their derived spec slug
            const bySpec = {};
            for (const e of bankPool.values()) {
                const spec = specSlugFor(e.bank_subtype) || '(other)';
                if (!bySpec[spec]) bySpec[spec] = [];
                bySpec[spec].push(e);
            }
            for (const arr of Object.values(bySpec)) arr.sort((a, b) => b.pool - a.pool);

            const groupsForSection = grpRes.rows.filter(g => g.exam_section_id === bankId);
            const rcGroups = groupsForSection.filter(g => g.group_type === 'RC');
            const rcQualifying = rcGroups.filter(g =>
                (g.passage_chars ?? 0) >= (config.rc_min_passage_chars || 0) &&
                g.size >= 5
            );
            const clozeGroups = groupsForSection.filter(g => g.group_type === 'CLOZE');
            const clozeQualifying = clozeGroups.filter(g =>
                (g.passage_chars ?? 0) >= (config.cloze_min_passage_chars || 0) &&
                g.size >= 5
            );
            const group_availability = {
                RC:    rcGroups.length,
                RC_qualifying: rcQualifying.length,
                CLOZE: clozeGroups.length,
                CLOZE_qualifying: clozeQualifying.length,
                DI:    groupsForSection.filter(g => g.group_type === 'DI').length,
            };

            return { code, bank_pool_by_spec: bySpec, group_availability };
        });

        // Inventory math (mirrors picker placeholders + group sizes)
        const placeholdersFromConfig = buildPlaceholderTemplates(config);
        const placeholdersBy = {
            REASONING: placeholdersFromConfig.filter(p => p.section_code === 'REASONING').length,
            GA: placeholdersFromConfig.filter(p => p.section_code === 'GA').length,
            QUANT: 0, ENGLISH: 0,
        };

        for (const s of sections) {
            const spec = SECTION_SPEC[s.code] || {};
            let groupSlotsClaimed = 0;
            for (const groupSpec of (spec.groups || [])) {
                const conditionMet =
                    (groupSpec.when_config && config[groupSpec.when_config]) ||
                    (groupSpec.group_type === 'DI' && config.include_quant_di);
                if (!conditionMet) continue;
                const availKey =
                    groupSpec.group_type === 'RC'    ? 'RC_qualifying'
                  : groupSpec.group_type === 'CLOZE' ? 'CLOZE_qualifying'
                  : groupSpec.group_type;
                if ((s.group_availability[availKey] ?? 0) > 0) {
                    groupSlotsClaimed += groupSpec.expected_size_max ?? 5;
                }
            }
            s.placeholder_count = placeholdersBy[s.code];
            s.group_slots = groupSlotsClaimed;
            s.inventory_needed = SECTION_TOTAL - s.placeholder_count - groupSlotsClaimed;
        }

        // Suggested defaults: for each spec target, distribute across the
        // largest-pool variations as 1's (then 2's if still short, etc.).
        const suggested_plan = {};
        for (const s of sections) {
            const spec = SECTION_SPEC[s.code] || {};
            const targets = spec.targets || {};
            suggested_plan[s.code] = {};
            for (const [specSlug, want] of Object.entries(targets)) {
                if (want <= 0) continue;
                const candidates = (s.bank_pool_by_spec[specSlug] || []).filter(c => c.pool > 0);
                if (candidates.length === 0) continue;
                let remaining = want;
                let perCandidate = 1;
                // Round-robin: give each candidate 1, then 2, until quota met or pool exhausted
                while (remaining > 0) {
                    let progressed = false;
                    for (const c of candidates) {
                        const cur = suggested_plan[s.code][c.bank_subtype] || 0;
                        if (cur < perCandidate && cur < c.pool) {
                            suggested_plan[s.code][c.bank_subtype] = cur + 1;
                            remaining--;
                            progressed = true;
                            if (remaining <= 0) break;
                        }
                    }
                    if (!progressed) break;
                    perCandidate++;
                }
            }
        }

        return NextResponse.json({
            success: true,
            config,
            sections,
            suggested_plan,
            difficulty_base: SECTION_DIFFICULTY_BASE,
            placeholder_counts: placeholderCountsBySection(config),
        });
    } catch (e) {
        console.error('cgl-mock/preview error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}

function specSlugFor(bankSubtype) {
    if (!bankSubtype) return null;
    for (const [slug, prefixes] of Object.entries(SUBTYPE_PREFIXES)) {
        for (const p of prefixes) {
            const stripped = p.endsWith('%') ? p.slice(0, -1) : p;
            if (bankSubtype.startsWith(stripped)) return slug;
        }
    }
    return null;
}
