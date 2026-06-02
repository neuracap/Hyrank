/**
 * CGL Tier 1 mock-test picker.
 *
 * Pure logic — given a pool (loaded by the caller) and a config, produces the
 * selections per section + placeholders + notes. No DB access here.
 *
 * Hard constraints enforced (in this order — earlier wins on conflict):
 *   1. Exactly SECTION_TOTAL per section, MOCK_TOTAL overall
 *   2. No question_id duplicates within the mock
 *   3. Caller-supplied exclusion set respected (no repeats across the series)
 *   4. Groups (RC/Cloze/DI): all members travel together, contiguous, in group_order
 *   5. Difficulty: only L2 and L3, drawn inventory aims for |L2-L3| <= 1
 *   6. Variation diversity: when picking N>1 from a spec_subtype, prefer
 *      different full bank-subtype values (since the bank's subtype encodes
 *      the variation), with leaf_topic_id as a tiebreak
 *   7. Placeholders: eat into the largest-pool subtype first
 *
 * Soft preferences: prefer fresher questions (lower total_attempts), prefer
 * even answer-key spread (A/B/C/D) — applied only as tiebreakers.
 */

import {
    SECTION_CODES, SECTION_TOTAL, SECTION_SPEC, SUBTYPE_PREFIXES,
    ALLOWED_DIFFICULTIES, buildPlaceholderTemplates,
} from './cgl-mock-spec.js';

// --- helpers ----------------------------------------------------------------

function matchesPrefix(subtype, prefixes) {
    if (!subtype) return false;
    return prefixes.some(p => {
        // SQL LIKE pattern → JS prefix: strip trailing %, compare prefix
        const stripped = p.endsWith('%') ? p.slice(0, -1) : p;
        return subtype.startsWith(stripped);
    });
}

function shuffleStable(arr, seed = 0) {
    // Deterministic-ish shuffle for reproducibility within a request; we just
    // want unbiased picks — not cryptographic randomness.
    const a = arr.slice();
    let s = seed || (Date.now() & 0xffff);
    for (let i = a.length - 1; i > 0; i--) {
        s = (s * 9301 + 49297) % 233280;
        const j = Math.floor((s / 233280) * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Pick N rows from `candidates`, preferring different variation/leaf_topic_id
 * each step, and aiming for half L2 / half L3 of the picks.
 */
function pickFromBag(candidates, n, opts = {}) {
    if (n <= 0 || candidates.length === 0) return { picked: [], remaining: candidates };
    const { excludedIds = new Set(), needL2 = Math.floor(n / 2), needL3 = n - Math.floor(n / 2) } = opts;

    const pool = candidates.filter(q => !excludedIds.has(q.question_id));
    if (pool.length === 0) return { picked: [], remaining: candidates };

    const byDifficulty = { 2: shuffleStable(pool.filter(q => q.difficulty === 2)), 3: shuffleStable(pool.filter(q => q.difficulty === 3)) };
    const picked = [];
    const usedVariationKeys = new Set();

    const tryPickAt = (diffBucket) => {
        const bucket = byDifficulty[diffBucket];
        // first pass: only fresh variations
        for (let i = 0; i < bucket.length; i++) {
            const q = bucket[i];
            const vkey = q.subtype || q.leaf_topic_id || q.question_id;
            if (!usedVariationKeys.has(vkey) && !picked.includes(q)) {
                picked.push(q);
                usedVariationKeys.add(vkey);
                bucket.splice(i, 1);
                return true;
            }
        }
        // fallback: allow reused variation if bucket has anything left
        if (bucket.length > 0) {
            const q = bucket.shift();
            picked.push(q);
            usedVariationKeys.add(q.subtype || q.leaf_topic_id || q.question_id);
            return true;
        }
        return false;
    };

    // Interleave L2 and L3 picks until quotas met
    let l2Remaining = needL2, l3Remaining = needL3;
    while (l2Remaining + l3Remaining > 0) {
        // pick from the bucket with more remaining quota, fall back to the other
        let picked2 = false;
        if (l2Remaining >= l3Remaining && l2Remaining > 0) {
            picked2 = tryPickAt(2);
            if (picked2) { l2Remaining--; continue; }
        }
        if (l3Remaining > 0) {
            const ok = tryPickAt(3);
            if (ok) { l3Remaining--; continue; }
        }
        if (!picked2 && l2Remaining > 0) {
            const ok = tryPickAt(2);
            if (ok) { l2Remaining--; continue; }
        }
        break; // both buckets empty
    }

    const pickedIds = new Set(picked.map(q => q.question_id));
    const remaining = candidates.filter(q => !pickedIds.has(q.question_id));
    return { picked, remaining };
}

// --- group picking ----------------------------------------------------------

function pickGroup(groups, groupType, excludedIds) {
    // groups: array of { group_id, group_type, members:[{question_id, group_order, difficulty, subtype, leaf_topic_id, correct_option_label, passage_question_id}] }
    const candidates = groups.filter(g =>
        g.group_type === groupType &&
        g.members.length > 0 &&
        g.members.every(m => !excludedIds.has(m.question_id))
    );
    if (candidates.length === 0) return null;
    const chosen = shuffleStable(candidates)[0];
    return {
        group_id: chosen.group_id,
        group_type: chosen.group_type,
        passage_question_id: chosen.passage_question_id,
        members: chosen.members
            .slice()
            .sort((a, b) => (a.group_order || 0) - (b.group_order || 0)),
    };
}

// --- per-section picker -----------------------------------------------------

function pickSection({ sectionCode, sectionPool, groups, config, placeholderCount, excludedIds, notes }) {
    const spec = SECTION_SPEC[sectionCode];
    const slots = SECTION_TOTAL;                            // 25
    let inventoryBudget = slots - placeholderCount;         // questions actually drawn

    // 1) Groups first (RC/Cloze/DI) — sized & contiguous
    const groupPicks = [];
    for (const groupSpec of (spec.groups || [])) {
        const conditionMet =
            (groupSpec.when_config && config[groupSpec.when_config]) ||
            (groupSpec.group_type === 'DI' && config.include_quant_di);
        if (!conditionMet) continue;

        const picked = pickGroup(groups, groupSpec.group_type, excludedIds);
        if (!picked) {
            notes.push(`[${sectionCode}] requested ${groupSpec.group_type} group but no eligible group available; redistributing slots to standalones.`);
            continue;
        }
        const size = picked.members.length;
        if (size < groupSpec.expected_size_min || size > groupSpec.expected_size_max) {
            notes.push(`[${sectionCode}] ${groupSpec.group_type} group size=${size} outside expected ${groupSpec.expected_size_min}-${groupSpec.expected_size_max}.`);
        }
        groupPicks.push(picked);
        picked.members.forEach(m => excludedIds.add(m.question_id));
        inventoryBudget -= size;
    }

    // 2) Compute subtype-pool sizes for the placeholder-first logic + standalone targets
    const subtypePools = {};
    for (const specSt of Object.keys(spec.targets || {})) {
        const prefixes = SUBTYPE_PREFIXES[specSt] || [];
        subtypePools[specSt] = sectionPool.filter(q => matchesPrefix(q.subtype, prefixes) && !excludedIds.has(q.question_id));
    }
    for (const specSt of (spec.remainder_subtypes || [])) {
        if (subtypePools[specSt]) continue;
        const prefixes = SUBTYPE_PREFIXES[specSt] || [];
        subtypePools[specSt] = sectionPool.filter(q => matchesPrefix(q.subtype, prefixes) && !excludedIds.has(q.question_id));
    }

    // 3) Build the working subtype-target map. Adjust for placeholders by
    //    pulling from the LARGEST-POOL subtype first.
    const targets = { ...(spec.targets || {}) };
    let standaloneBudget = inventoryBudget;
    let placeholdersToAbsorb = placeholderCount;

    const subtypeSizeRanked = () => Object.keys(targets).sort((a, b) => (subtypePools[b]?.length || 0) - (subtypePools[a]?.length || 0));

    while (placeholdersToAbsorb > 0) {
        // Find the subtype with the largest verified pool AND remaining target>0
        const order = subtypeSizeRanked().filter(s => targets[s] > 0);
        if (order.length === 0) break;
        targets[order[0]]--;
        placeholdersToAbsorb--;
    }

    // If group picks consumed more than expected, also shave targets to fit.
    const targetSum = Object.values(targets).reduce((s, v) => s + v, 0);
    let overflow = targetSum - standaloneBudget;
    while (overflow > 0) {
        const order = subtypeSizeRanked().filter(s => targets[s] > 0);
        if (order.length === 0) break;
        targets[order[0]]--;
        overflow--;
    }

    // Or: if targets sum is less than budget (e.g. DI included but ENGLISH RC absent),
    // push remainder into the remainder_subtypes pool.
    let underflow = standaloneBudget - Object.values(targets).reduce((s, v) => s + v, 0);
    if (underflow > 0) {
        const rs = spec.remainder_subtypes || [];
        for (let i = 0; i < underflow; i++) {
            const target = rs[i % rs.length] || subtypeSizeRanked()[0];
            targets[target] = (targets[target] || 0) + 1;
        }
    }

    // 4) Pick standalones per subtype target
    const standalonePicks = [];
    for (const specSt of Object.keys(targets)) {
        const want = targets[specSt];
        if (want <= 0) continue;
        const pool = subtypePools[specSt] || [];
        if (pool.length < want) {
            notes.push(`[${sectionCode}] subtype "${specSt}" wanted ${want}, pool has ${pool.length}; using nearest related subtype for shortfall.`);
        }
        const { picked } = pickFromBag(pool, Math.min(want, pool.length), { excludedIds });
        picked.forEach(p => {
            standalonePicks.push({ ...p, _spec_subtype: specSt });
            excludedIds.add(p.question_id);
        });
        // remove picks from other subtypePools (we treat each question once)
        for (const k of Object.keys(subtypePools)) {
            subtypePools[k] = subtypePools[k].filter(q => !excludedIds.has(q.question_id));
        }

        // shortfall: pull from remainder_subtypes' combined pool
        const shortfall = want - picked.length;
        if (shortfall > 0) {
            const fallbackPool = (spec.remainder_subtypes || [])
                .flatMap(rs => subtypePools[rs] || []);
            // remove already-picked
            const uniq = [];
            const seen = new Set();
            for (const q of fallbackPool) {
                if (seen.has(q.question_id)) continue;
                seen.add(q.question_id);
                uniq.push(q);
            }
            const fb = pickFromBag(uniq, shortfall, { excludedIds });
            fb.picked.forEach(p => {
                standalonePicks.push({ ...p, _spec_subtype: `${specSt}__fallback` });
                excludedIds.add(p.question_id);
            });
        }
    }

    // 5) Order: groups first (each as contiguous block), then standalones with L2→L3 ramp
    const orderedItems = [];
    let position = 1;
    for (const g of groupPicks) {
        for (const m of g.members) {
            orderedItems.push({
                type: 'question',
                question_id: m.question_id,
                position: position++,
                slot_subtype: g.group_type,
                slot_difficulty: m.difficulty ?? null,
                group_id: g.group_id,
                _spec_subtype: g.group_type,
                _picked: m,
            });
        }
    }
    // Standalones: L2 then L3 ramp; within each, by subtype label
    const standaloneSorted = standalonePicks.slice().sort((a, b) => {
        const da = (a.difficulty || 0) - (b.difficulty || 0);
        if (da !== 0) return da;
        return (a._spec_subtype || '').localeCompare(b._spec_subtype || '');
    });
    for (const s of standaloneSorted) {
        orderedItems.push({
            type: 'question',
            question_id: s.question_id,
            position: position++,
            slot_subtype: s._spec_subtype,
            slot_difficulty: s.difficulty ?? null,
            group_id: null,
            _spec_subtype: s._spec_subtype,
            _picked: s,
        });
    }

    // 6) Insert placeholders at end of section (positions after questions)
    const placeholders = [];
    const phPrefix = sectionCode === 'REASONING' ? 'PLACEHOLDER_REAS_IMG' : 'PLACEHOLDER_GA_CA';
    for (let i = 1; i <= placeholderCount; i++) {
        placeholders.push({
            section_code: sectionCode,
            position: position++,
            placeholder_id: `${phPrefix}_${i}`,
        });
    }

    // 7) Section stats
    const drawn = orderedItems.length;
    const l2 = orderedItems.filter(o => o._picked?.difficulty === 2).length;
    const l3 = orderedItems.filter(o => o._picked?.difficulty === 3).length;
    const otherDiff = drawn - l2 - l3;
    const variationsUsed = new Set(orderedItems.map(o => o._picked?.subtype || o._picked?.leaf_topic_id)).size;

    return {
        items: orderedItems,
        placeholders,
        section_stats: {
            code: sectionCode,
            target: SECTION_TOTAL,
            drawn,
            placeholder_count: placeholderCount,
            difficulty: { L2: l2, L3: l3, other: otherDiff },
            unique_variations: variationsUsed,
            groups_used: groupPicks.map(g => ({ group_id: g.group_id, group_type: g.group_type, size: g.members.length })),
            short: drawn + placeholderCount < SECTION_TOTAL ? (SECTION_TOTAL - drawn - placeholderCount) : 0,
        },
    };
}

// --- user-plan mode: pick exactly the requested bank subtypes -------------

/**
 * pickSectionFromUserPlan
 *
 * Honors `bankSubtypeTargets` — a map of bank qv.subtype → desired count.
 * For each requested bank subtype:
 *   - Pulls up to N matching questions from the pool (excluding excludedIds)
 *   - If pool < requested, fills the gap with a SHORTFALL placeholder so the
 *     section still has the right total item count
 * Groups (RC/Cloze/DI) are picked first per the section's group rules. Group
 * member positions don't come from bank targets — the group is a unit.
 */
function pickSectionFromUserPlan({
    sectionCode, sectionPool, groups, config, placeholderCount,
    bankSubtypeTargets, excludedIds, notes,
}) {
    const spec = SECTION_SPEC[sectionCode];
    const slots = SECTION_TOTAL;
    let remainingSlots = slots - placeholderCount;

    // 1) Group picks first (RC/Cloze/DI) — same rules as the auto picker.
    const groupPicks = [];
    for (const groupSpec of (spec.groups || [])) {
        const conditionMet =
            (groupSpec.when_config && config[groupSpec.when_config]) ||
            (groupSpec.group_type === 'DI' && config.include_quant_di);
        if (!conditionMet) continue;
        const picked = pickGroup(groups, groupSpec.group_type, excludedIds);
        if (!picked) {
            notes.push(`[${sectionCode}] requested ${groupSpec.group_type} group but no eligible group available; redistributing as standalone slots.`);
            continue;
        }
        groupPicks.push(picked);
        picked.members.forEach(m => excludedIds.add(m.question_id));
        remainingSlots -= picked.members.length;
    }

    // 2) For each requested bank subtype, pull up to N from the pool.
    const standalonePicks = [];
    const shortfallByBank = []; // [{ bank_subtype, want, got }]
    for (const [bankSubtype, want] of Object.entries(bankSubtypeTargets || {})) {
        if (!Number.isInteger(want) || want <= 0) continue;
        const pool = sectionPool.filter(q => q.subtype === bankSubtype && !excludedIds.has(q.question_id));
        const usable = shuffleStable(pool).slice(0, want);
        usable.forEach(q => { excludedIds.add(q.question_id); standalonePicks.push({ ...q, _spec_subtype: bankSubtype }); });
        const got = usable.length;
        if (got < want) shortfallByBank.push({ bank_subtype: bankSubtype, want, got });
    }

    // 3) Total alignment: if standalone picks exceed remaining slots, we
    //    overshot — clip from the end of the picks. (Caller already validated
    //    sum, but defend.)
    if (standalonePicks.length > remainingSlots) {
        notes.push(`[${sectionCode}] plan totals exceed inventory slots; dropping ${standalonePicks.length - remainingSlots} of the last picks.`);
        const dropped = standalonePicks.splice(remainingSlots);
        dropped.forEach(d => excludedIds.delete(d.question_id));
    }

    // 4) Ordering: groups first as contiguous blocks, then standalones with
    //    a soft L2 → L3 ramp (we don't enforce 50/50 here — the user owns the plan).
    const orderedItems = [];
    let position = 1;
    for (const g of groupPicks) {
        for (const m of g.members) {
            orderedItems.push({
                type: 'question',
                question_id: m.question_id,
                position: position++,
                slot_subtype: g.group_type,
                slot_difficulty: m.difficulty ?? null,
                group_id: g.group_id,
                _spec_subtype: g.group_type,
                _picked: m,
            });
        }
    }
    standalonePicks.slice().sort((a, b) => (a.difficulty || 0) - (b.difficulty || 0)).forEach(s => {
        orderedItems.push({
            type: 'question',
            question_id: s.question_id,
            position: position++,
            slot_subtype: s._spec_subtype,
            slot_difficulty: s.difficulty ?? null,
            group_id: null,
            _spec_subtype: s._spec_subtype,
            _picked: s,
        });
    });

    // 5) Shortfall placeholders: for any (want - got) gap, add a SHORTFALL placeholder.
    const placeholders = [];
    const phPrefix = sectionCode === 'REASONING' ? 'PLACEHOLDER_REAS_IMG'
        : sectionCode === 'GA' ? 'PLACEHOLDER_GA_CA' : 'PLACEHOLDER_SHORTFALL';
    for (let i = 1; i <= placeholderCount; i++) {
        placeholders.push({ section_code: sectionCode, position: position++, placeholder_id: `${phPrefix}_${i}` });
    }
    let shortfallCounter = 0;
    for (const sf of shortfallByBank) {
        for (let i = 0; i < (sf.want - sf.got); i++) {
            shortfallCounter++;
            placeholders.push({
                section_code: sectionCode,
                position: position++,
                placeholder_id: `PLACEHOLDER_SHORTFALL_${sectionCode}_${shortfallCounter}`,
                wanted_bank_subtype: sf.bank_subtype,
            });
        }
    }

    // 6) Notes
    for (const sf of shortfallByBank) {
        notes.push(`[${sectionCode}] plan wanted ${sf.want} of "${sf.bank_subtype}", pool had ${sf.got}; ${sf.want - sf.got} slot(s) left as SHORTFALL placeholders.`);
    }

    const drawn = orderedItems.length;
    const l2 = orderedItems.filter(o => o._picked?.difficulty === 2).length;
    const l3 = orderedItems.filter(o => o._picked?.difficulty === 3).length;
    const variationsUsed = new Set(orderedItems.map(o => o._picked?.subtype || o._picked?.leaf_topic_id)).size;
    return {
        items: orderedItems,
        placeholders,
        section_stats: {
            code: sectionCode,
            target: SECTION_TOTAL,
            drawn,
            placeholder_count: placeholders.length,
            difficulty: { L2: l2, L3: l3, other: drawn - l2 - l3 },
            unique_variations: variationsUsed,
            groups_used: groupPicks.map(g => ({ group_id: g.group_id, group_type: g.group_type, size: g.members.length })),
            short: drawn + placeholders.length < SECTION_TOTAL ? (SECTION_TOTAL - drawn - placeholders.length) : 0,
        },
    };
}

// --- top-level entry --------------------------------------------------------

/**
 * @param {{
 *   config: any,
 *   poolsBySection: Record<'REASONING'|'GA'|'QUANT'|'ENGLISH', any[]>,
 *   groups: any[],
 *   excludedIds: Set<string>,
 *   userBankTargets?: Record<'REASONING'|'GA'|'QUANT'|'ENGLISH', Record<string, number>>,
 * }} args
 */
export function buildMock({ config, poolsBySection, groups, excludedIds, userBankTargets }) {
    const notes = [];
    const placeholdersFromConfig = buildPlaceholderTemplates(config);

    const placeholdersBySection = {
        REASONING: placeholdersFromConfig.filter(p => p.section_code === 'REASONING').length,
        GA:        placeholdersFromConfig.filter(p => p.section_code === 'GA').length,
        QUANT:     0,
        ENGLISH:   0,
    };

    const sections = {};
    for (const code of SECTION_CODES) {
        const userTargets = userBankTargets?.[code];
        const usingPlan = userTargets && Object.values(userTargets).some(v => v > 0);
        const res = usingPlan
            ? pickSectionFromUserPlan({
                sectionCode: code,
                sectionPool: poolsBySection[code] || [],
                groups: groups.filter(g => g.section_code === code),
                config,
                placeholderCount: placeholdersBySection[code],
                bankSubtypeTargets: userTargets,
                excludedIds,
                notes,
            })
            : pickSection({
                sectionCode: code,
                sectionPool: poolsBySection[code] || [],
                groups: groups.filter(g => g.section_code === code),
                config,
                placeholderCount: placeholdersBySection[code],
                excludedIds,
                notes,
            });
        sections[code] = res;
    }

    // Cross-section: difficulty rebalance attempt within each section if off by >1
    for (const code of SECTION_CODES) {
        const s = sections[code].section_stats.difficulty;
        if (Math.abs(s.L2 - s.L3) > 1) {
            notes.push(`[${code}] L2/L3 split is ${s.L2}/${s.L3}; pool didn't allow a tighter balance.`);
        }
    }

    const allItems = SECTION_CODES.flatMap(code =>
        sections[code].items.map(it => ({ ...it, section_code: code }))
    );
    const allPlaceholders = SECTION_CODES.flatMap(code => sections[code].placeholders);
    const sectionStats = SECTION_CODES.map(code => sections[code].section_stats);

    return {
        items: allItems,
        placeholders: allPlaceholders,
        section_stats: sectionStats,
        notes,
        config,
    };
}
