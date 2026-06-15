import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { getSpec } from '@/lib/mock-spec-resolver';

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
    const SPEC = getSpec(body?.examKey);
    const {
        BANK_SECTION_IDS, SECTION_CODES, SECTION_TOTAL,
        SECTION_SPEC, SUBTYPE_PREFIXES, SECTION_DIFFICULTY_BASE,
        BUCKET_TOPICS, MAX_PER_TOPIC, ALLOWED_SOURCE_TYPES, PYQ_CAP_PER_SECTION,
        normalizeConfig, buildPlaceholderTemplates, placeholderCountsBySection,
    } = SPEC;
    const config = normalizeConfig(body);

    const client = await db.connect();
    try {
        const bankSectionIds = SECTION_CODES.map(c => BANK_SECTION_IDS[c]);

        // 1. Pool depths per (section, bank_subtype, difficulty)
        // CA freshness predicate: ca_% subtypes must clear (current YQ - freshness_quarters).
        const now = new Date();
        const currentYq = now.getFullYear() * 4 + (Math.floor(now.getMonth() / 3) + 1);
        const caCutoffYq = currentYq - (config.ca_freshness_quarters || 4);
        // Pool depths now include CHSL bank + CHSL PYQ (source_type IN ('bank','pyq')).
        // The picker prefers bank within each subtype but allows up to
        // PYQ_CAP_PER_SECTION (= 10) PYQ picks per section. CA freshness applies only
        // to bank `ca_*` rows (PYQ ca questions don't carry relevance_year metadata).
        const poolRes = await client.query(`
            SELECT qv.exam_section_id, qv.subtype, qv.difficulty, qv.source_type, COUNT(*)::int AS c
            FROM question_version qv
            WHERE qv.source_type = ANY($4) AND qv.question_type='MCQ' AND qv.language='EN'
              AND qv.solution_status='DONE' AND qv.correct_option_label IS NOT NULL
              AND COALESCE(qv.status,'') != 'JUNK'
              AND COALESCE((qv.meta_json->'resolve'->>'match')::boolean, true) = true
              AND qv.exam_section_id = ANY($1)
              AND qv.difficulty IN (1,2,3,4)
              AND (
                qv.subtype NOT LIKE 'ca\\_%' ESCAPE '\\'
                OR qv.source_type != 'bank'
                OR (
                    (qv.meta_json->>'relevance_year')::int * 4
                    + (qv.meta_json->>'relevance_quarter')::int >= $3
                )
              )
              AND NOT EXISTS (
                  SELECT 1 FROM mock_test_question mtq
                  JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
                  WHERE mtq.question_id = qv.question_id AND mt.exam_id = $2
              )
            GROUP BY qv.exam_section_id, qv.subtype, qv.difficulty, qv.source_type
            ORDER BY qv.exam_section_id, COUNT(*) DESC
        `, [bankSectionIds, SPEC.examId, caCutoffYq, ALLOWED_SOURCE_TYPES]);

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
        `, [bankSectionIds, SPEC.examId]);

        // Inversion: bank_section_id -> code
        const codeByBankId = Object.fromEntries(SECTION_CODES.map(c => [BANK_SECTION_IDS[c], c]));

        // Aggregate
        const sections = SECTION_CODES.map(code => {
            const bankId = BANK_SECTION_IDS[code];
            const rowsHere = poolRes.rows.filter(r => r.exam_section_id === bankId);
            // bank_subtype → { pool, L1, L2, L3, L4, bank_pool, pyq_pool }
            // pool = total (bank + pyq); bank_pool / pyq_pool break it out for UI.
            const bankPool = new Map();
            for (const row of rowsHere) {
                if (!bankPool.has(row.subtype)) {
                    bankPool.set(row.subtype, {
                        bank_subtype: row.subtype,
                        pool: 0, bank_pool: 0, pyq_pool: 0,
                        L1: 0, L2: 0, L3: 0, L4: 0,
                    });
                }
                const e = bankPool.get(row.subtype);
                e.pool += row.c;
                if (row.source_type === 'bank') e.bank_pool += row.c;
                else if (row.source_type === 'pyq') e.pyq_pool += row.c;
                if (row.difficulty === 1) e.L1 += row.c;
                else if (row.difficulty === 2) e.L2 += row.c;
                else if (row.difficulty === 3) e.L3 += row.c;
                else if (row.difficulty === 4) e.L4 += row.c;
            }

            // Group bank subtypes by their derived spec slug
            const bySpec = {};
            for (const e of bankPool.values()) {
                const spec = specSlugFor(e.bank_subtype, SUBTYPE_PREFIXES) || '(other)';
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
        const placeholdersBy = Object.fromEntries(SECTION_CODES.map(code => [
            code,
            placeholdersFromConfig.filter(p => p.section_code === code).length,
        ]));

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

        // Suggested defaults: for each spec target, distribute across bank subtypes.
        // BEFORE distributing, trim targets so their sum matches s.inventory_needed
        // (= SECTION_TOTAL - placeholders - groupSlots). Without this trim, REASONING
        // with 3 image placeholders gets a 25-question plan against a 22-question
        // budget — 3 over, and the picker silently clips them at insert time.
        // Round-robin trim across non-protected slugs, ranked by pool size descending,
        // mirrors what pickSection does internally so the plan and the picker agree.
        const suggested_plan = {};
        for (const s of sections) {
            const spec = SECTION_SPEC[s.code] || {};
            const targets = { ...(spec.targets || {}) };
            suggested_plan[s.code] = {};

            const protectedSet = new Set(spec.protected_targets || []);
            const slugPool = (slug) => (s.bank_pool_by_spec[slug] || []).reduce((acc, c) => acc + c.pool, 0);
            const budget = s.inventory_needed ?? SECTION_TOTAL;
            let overflow = Object.values(targets).reduce((a, b) => a + b, 0) - budget;
            if (overflow > 0) {
                const trimOrder = Object.keys(targets)
                    .filter(k => !protectedSet.has(k))
                    .sort((a, b) => slugPool(b) - slugPool(a));
                let i = 0;
                while (overflow > 0) {
                    const remaining = trimOrder.filter(k => targets[k] > 0);
                    if (remaining.length === 0) break;
                    targets[remaining[i % remaining.length]]--;
                    overflow--;
                    i++;
                }
            }

            for (const [specSlug, want] of Object.entries(targets)) {
                if (want <= 0) continue;
                const candidates = (s.bank_pool_by_spec[specSlug] || []).filter(c => c.pool > 0);
                if (candidates.length === 0) continue;

                const topicMap = BUCKET_TOPICS[specSlug];
                if (topicMap) {
                    distributeAcrossTopics(suggested_plan[s.code], candidates, want, topicMap, MAX_PER_TOPIC[specSlug] ?? 2);
                } else {
                    distributePerBankSubtype(suggested_plan[s.code], candidates, want);
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
            pyq_cap_per_section: PYQ_CAP_PER_SECTION,
            source_split: 'bank-preferred, PYQ falls through within each topic; section-wide PYQ cap = 10 (40%)',
        });
    } catch (e) {
        console.error('cgl-mock/preview error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}

function specSlugFor(bankSubtype, subtypePrefixes) {
    if (!bankSubtype) return null;
    for (const [slug, prefixes] of Object.entries(subtypePrefixes)) {
        for (const p of prefixes) {
            const stripped = p.endsWith('%') ? p.slice(0, -1) : p;
            if (bankSubtype.startsWith(stripped)) return slug;
        }
    }
    return null;
}

/**
 * Round-robin per BANK SUBTYPE (legacy; clusters when many bank subtypes share a topic).
 * Mutates `out` in place: { bank_subtype: count }.
 */
function distributePerBankSubtype(out, candidates, want) {
    let remaining = want;
    let perCandidate = 1;
    while (remaining > 0) {
        let progressed = false;
        for (const c of candidates) {
            const cur = out[c.bank_subtype] || 0;
            if (cur < perCandidate && cur < c.pool) {
                out[c.bank_subtype] = cur + 1;
                remaining--;
                progressed = true;
                if (remaining <= 0) break;
            }
        }
        if (!progressed) break;
        perCandidate++;
    }
}

/**
 * Round-robin across TOPICS first (1 per topic, 2 per topic, ... up to maxPerTopic).
 * Inside each topic, pick the bank subtype with the largest pool that hasn't been
 * given a count yet, then growing. Mirrors the picker's auto-mode logic.
 * Mutates `out` in place: { bank_subtype: count }.
 */
function distributeAcrossTopics(out, candidates, want, topicMap, maxPerTopic) {
    const topicNames = Object.keys(topicMap);
    const byTopic = { _other: [] };
    for (const t of topicNames) byTopic[t] = [];

    for (const c of candidates) {
        let placed = false;
        for (const t of topicNames) {
            for (const p of topicMap[t]) {
                const stripped = p.endsWith('%') ? p.slice(0, -1) : p;
                if (c.bank_subtype.startsWith(stripped)) {
                    byTopic[t].push(c);
                    placed = true;
                    break;
                }
            }
            if (placed) break;
        }
        if (!placed) byTopic._other.push(c);
    }
    // Largest-pool bank subtype first within each topic (so suggested defaults
    // surface the deepest variation; user can swap in PlanModal if they want).
    for (const t of Object.keys(byTopic)) byTopic[t].sort((a, b) => b.pool - a.pool);

    const givenPerTopic = {};
    for (const t of topicNames) givenPerTopic[t] = 0;

    let remaining = want;
    for (let pass = 1; pass <= maxPerTopic && remaining > 0; pass++) {
        for (const t of topicNames) {
            if (remaining <= 0) break;
            if (givenPerTopic[t] >= pass) continue;
            const bucket = byTopic[t];
            if (!bucket || bucket.length === 0) continue;
            // Prefer a bank subtype within this topic that hasn't been used yet
            // (so pass 2 within a topic surfaces a DIFFERENT variation, not the
            // same bank subtype with count incremented). Fall back to any with
            // room left if every subtype has already been touched.
            let chosen = null;
            for (const c of bucket) {
                if ((out[c.bank_subtype] || 0) === 0 && c.pool > 0) { chosen = c; break; }
            }
            if (!chosen) {
                for (const c of bucket) {
                    const cur = out[c.bank_subtype] || 0;
                    if (cur < c.pool) { chosen = c; break; }
                }
            }
            if (!chosen) continue;
            out[chosen.bank_subtype] = (out[chosen.bank_subtype] || 0) + 1;
            givenPerTopic[t]++;
            remaining--;
        }
    }
    // Still short: drain _other.
    while (remaining > 0 && byTopic._other.length > 0) {
        const c = byTopic._other[0];
        const cur = out[c.bank_subtype] || 0;
        if (cur < c.pool) {
            out[c.bank_subtype] = cur + 1;
            remaining--;
        } else {
            byTopic._other.shift();
        }
    }
    // Still short: drain past cap across all topics, largest pool first.
    if (remaining > 0) {
        const flat = candidates.slice().sort((a, b) => b.pool - a.pool);
        for (const c of flat) {
            if (remaining <= 0) break;
            const cur = out[c.bank_subtype] || 0;
            if (cur < c.pool) {
                out[c.bank_subtype] = cur + 1;
                remaining--;
            }
        }
    }
}
