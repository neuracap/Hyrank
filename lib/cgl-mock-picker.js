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
 *   5. Bank_subtype quantities (in user-plan mode) are honored exactly
 *   6. Variation diversity: when picking N>1 from a spec_subtype, prefer
 *      different full bank-subtype values (since the bank's subtype encodes
 *      the variation), with leaf_topic_id as a tiebreak
 *   7. Placeholders: eat into the largest-pool subtype first (auto mode only)
 *
 * Soft preference (NEW): per-section difficulty profile (L1/L2/L3/L4). Within
 * each pick we bias toward whichever level still has the largest deficit
 * relative to the user-set profile. Drift is reported in section_stats.
 */

import {
    SECTION_CODES, SECTION_TOTAL, SECTION_SPEC, SUBTYPE_PREFIXES,
    DIFFICULTY_LEVELS, SECTION_DIFFICULTY_BASE,
    buildPlaceholderTemplates, placeholderCountsBySection,
} from './cgl-mock-spec.js';

// --- helpers ----------------------------------------------------------------

function matchesPrefix(subtype, prefixes) {
    if (!subtype) return false;
    return prefixes.some(p => {
        const stripped = p.endsWith('%') ? p.slice(0, -1) : p;
        return subtype.startsWith(stripped);
    });
}

function shuffleStable(arr, seed = 0) {
    const a = arr.slice();
    let s = seed || (Date.now() & 0xffff);
    for (let i = a.length - 1; i > 0; i--) {
        s = (s * 9301 + 49297) % 233280;
        const j = Math.floor((s / 233280) * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function emptyLevelMap() {
    return { L1: 0, L2: 0, L3: 0, L4: 0 };
}

function levelKey(d) {
    if (d === 1) return 'L1';
    if (d === 2) return 'L2';
    if (d === 3) return 'L3';
    if (d === 4) return 'L4';
    return null;
}

/**
 * Pick N rows from `candidates`, biased toward whichever difficulty level
 * has the largest remaining deficit in `levelDeficit`. Variation diversity
 * (different bank subtype / leaf topic) is preferred as a soft tiebreaker.
 *
 * `levelDeficit` is MUTATED: each pick decrements its level's deficit.
 * The deficit may go negative when bag inventory forces oversupply of a level;
 * that just deprioritizes future picks of that level.
 */
function pickFromBagBiased(candidates, n, { excludedIds, levelDeficit }) {
    if (n <= 0 || candidates.length === 0) return { picked: [], remaining: candidates };
    const pool = candidates.filter(q => !excludedIds.has(q.question_id));
    if (pool.length === 0) return { picked: [], remaining: candidates };

    const byDifficulty = {
        1: shuffleStable(pool.filter(q => q.difficulty === 1)),
        2: shuffleStable(pool.filter(q => q.difficulty === 2)),
        3: shuffleStable(pool.filter(q => q.difficulty === 3)),
        4: shuffleStable(pool.filter(q => q.difficulty === 4)),
    };
    const picked = [];
    const usedVariationKeys = new Set();

    const pickOneAtLevel = (lvl) => {
        const bucket = byDifficulty[lvl];
        if (!bucket || bucket.length === 0) return false;
        // First pass: fresh variation
        for (let i = 0; i < bucket.length; i++) {
            const q = bucket[i];
            const vkey = q.subtype || q.leaf_topic_id || q.question_id;
            if (!usedVariationKeys.has(vkey)) {
                picked.push(q);
                usedVariationKeys.add(vkey);
                bucket.splice(i, 1);
                return true;
            }
        }
        // Fallback: any row left in this bucket
        const q = bucket.shift();
        picked.push(q);
        usedVariationKeys.add(q.subtype || q.leaf_topic_id || q.question_id);
        return true;
    };

    for (let i = 0; i < n; i++) {
        // Rank available levels by current deficit, descending.
        // Levels with empty buckets are excluded.
        const levelsAvailable = DIFFICULTY_LEVELS.filter(l => byDifficulty[l].length > 0);
        if (levelsAvailable.length === 0) break;
        levelsAvailable.sort((a, b) => {
            const da = (levelDeficit?.[`L${b}`] ?? 0) - (levelDeficit?.[`L${a}`] ?? 0);
            if (da !== 0) return da;
            // Tiebreak: prefer lower difficulty (gentler ramp)
            return a - b;
        });
        let didPick = false;
        for (const lvl of levelsAvailable) {
            if (pickOneAtLevel(lvl)) {
                if (levelDeficit) levelDeficit[`L${lvl}`]--;
                didPick = true;
                break;
            }
        }
        if (!didPick) break;
    }

    const pickedIds = new Set(picked.map(q => q.question_id));
    const remaining = candidates.filter(q => !pickedIds.has(q.question_id));
    return { picked, remaining };
}

// --- group picking ----------------------------------------------------------

function pickGroup(groups, groupType, excludedIds, opts = {}) {
    const { minSize = 0, minPassageChars = 0 } = opts;
    const candidates = groups.filter(g =>
        g.group_type === groupType &&
        g.members.length > 0 &&
        g.members.length >= minSize &&
        (g.passage_chars ?? 0) >= minPassageChars &&
        g.members.every(m => !excludedIds.has(m.question_id))
    );
    if (candidates.length === 0) return null;
    // Prefer longer passages — longest wins; ties broken randomly.
    const ranked = shuffleStable(candidates)
        .sort((a, b) => (b.passage_chars ?? 0) - (a.passage_chars ?? 0));
    const chosen = ranked[0];
    return {
        group_id: chosen.group_id,
        group_type: chosen.group_type,
        passage_question_id: chosen.passage_question_id,
        passage_chars: chosen.passage_chars ?? null,
        members: chosen.members
            .slice()
            .sort((a, b) => (a.group_order || 0) - (b.group_order || 0)),
    };
}

function countByLevel(items) {
    const out = emptyLevelMap();
    for (const it of items) {
        const k = levelKey(it.difficulty);
        if (k) out[k]++;
    }
    return out;
}

function deficitFromTarget(target, alreadyPicked) {
    return {
        L1: (target.L1 || 0) - (alreadyPicked.L1 || 0),
        L2: (target.L2 || 0) - (alreadyPicked.L2 || 0),
        L3: (target.L3 || 0) - (alreadyPicked.L3 || 0),
        L4: (target.L4 || 0) - (alreadyPicked.L4 || 0),
    };
}

function driftFromTargetActual(target, actual) {
    return {
        L1: (actual.L1 || 0) - (target.L1 || 0),
        L2: (actual.L2 || 0) - (target.L2 || 0),
        L3: (actual.L3 || 0) - (target.L3 || 0),
        L4: (actual.L4 || 0) - (target.L4 || 0),
    };
}

// --- per-section picker (auto mode) -----------------------------------------

function pickSection({
    sectionCode, sectionPool, groups, config, placeholderCount,
    difficultyTarget, excludedIds, notes,
}) {
    const spec = SECTION_SPEC[sectionCode];
    const slots = SECTION_TOTAL;
    let inventoryBudget = slots - placeholderCount;

    // 1) Groups first (RC/Cloze/DI) — sized & contiguous
    const groupPicks = [];
    for (const groupSpec of (spec.groups || [])) {
        const conditionMet =
            (groupSpec.when_config && config[groupSpec.when_config]) ||
            (groupSpec.group_type === 'DI' && config.include_quant_di);
        if (!conditionMet) continue;

        const minPassageChars =
            groupSpec.group_type === 'RC'    ? (config.rc_min_passage_chars || 0)
          : groupSpec.group_type === 'CLOZE' ? (config.cloze_min_passage_chars || 0)
          : 0;
        const picked = pickGroup(groups, groupSpec.group_type, excludedIds, {
            minSize: groupSpec.expected_size_min || 0,
            minPassageChars,
        });
        if (!picked) {
            const threshNote = minPassageChars > 0 ? ` (≥${minPassageChars} chars, ≥${groupSpec.expected_size_min} questions)` : '';
            notes.push(`[${sectionCode}] no eligible ${groupSpec.group_type} group${threshNote}; redistributing slots to standalones.`);
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

    // Section-level difficulty deficit, seeded from target and decremented as
    // groups + standalones land.
    const groupMembersByLevel = countByLevel(groupPicks.flatMap(g => g.members));
    const levelDeficit = deficitFromTarget(difficultyTarget, groupMembersByLevel);

    // 2) Subtype pools (for placeholder absorption + standalone targets)
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
    const standaloneBudget = inventoryBudget;
    let placeholdersToAbsorb = placeholderCount;

    const subtypeSizeRanked = () => Object.keys(targets).sort((a, b) => (subtypePools[b]?.length || 0) - (subtypePools[a]?.length || 0));

    while (placeholdersToAbsorb > 0) {
        const order = subtypeSizeRanked().filter(s => targets[s] > 0);
        if (order.length === 0) break;
        targets[order[0]]--;
        placeholdersToAbsorb--;
    }

    const targetSum = Object.values(targets).reduce((s, v) => s + v, 0);
    let overflow = targetSum - standaloneBudget;
    while (overflow > 0) {
        const order = subtypeSizeRanked().filter(s => targets[s] > 0);
        if (order.length === 0) break;
        targets[order[0]]--;
        overflow--;
    }

    let underflow = standaloneBudget - Object.values(targets).reduce((s, v) => s + v, 0);
    if (underflow > 0) {
        const rs = spec.remainder_subtypes || [];
        for (let i = 0; i < underflow; i++) {
            const target = rs[i % rs.length] || subtypeSizeRanked()[0];
            targets[target] = (targets[target] || 0) + 1;
        }
    }

    // 4) Pick standalones per subtype target, deficit-biased
    const standalonePicks = [];
    for (const specSt of Object.keys(targets)) {
        const want = targets[specSt];
        if (want <= 0) continue;
        const pool = subtypePools[specSt] || [];
        if (pool.length < want) {
            notes.push(`[${sectionCode}] subtype "${specSt}" wanted ${want}, pool has ${pool.length}; using nearest related subtype for shortfall.`);
        }
        const { picked } = pickFromBagBiased(pool, Math.min(want, pool.length), { excludedIds, levelDeficit });
        picked.forEach(p => {
            standalonePicks.push({ ...p, _spec_subtype: specSt });
            excludedIds.add(p.question_id);
        });
        for (const k of Object.keys(subtypePools)) {
            subtypePools[k] = subtypePools[k].filter(q => !excludedIds.has(q.question_id));
        }

        const shortfall = want - picked.length;
        if (shortfall > 0) {
            const fallbackPool = (spec.remainder_subtypes || [])
                .flatMap(rs => subtypePools[rs] || []);
            const uniq = [];
            const seen = new Set();
            for (const q of fallbackPool) {
                if (seen.has(q.question_id)) continue;
                seen.add(q.question_id);
                uniq.push(q);
            }
            const fb = pickFromBagBiased(uniq, shortfall, { excludedIds, levelDeficit });
            fb.picked.forEach(p => {
                standalonePicks.push({ ...p, _spec_subtype: `${specSt}__fallback` });
                excludedIds.add(p.question_id);
            });
        }
    }

    // 5) Order: groups first (contiguous blocks), then standalones with L-ascending ramp
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

    // 6) Placeholders at end of section
    const placeholders = [];
    const phPrefix = sectionCode === 'REASONING' ? 'PLACEHOLDER_REAS_IMG' : 'PLACEHOLDER_GA_CA';
    for (let i = 1; i <= placeholderCount; i++) {
        placeholders.push({
            section_code: sectionCode,
            position: position++,
            placeholder_id: `${phPrefix}_${i}`,
        });
    }

    return buildSectionResult({
        sectionCode, orderedItems, placeholders, groupPicks,
        difficultyTarget, placeholderCount, notes,
    });
}

// --- user-plan mode: pick exactly the requested bank subtypes -------------

function pickSectionFromUserPlan({
    sectionCode, sectionPool, groups, config, placeholderCount,
    bankSubtypeTargets, difficultyTarget, excludedIds, notes,
}) {
    const spec = SECTION_SPEC[sectionCode];
    const slots = SECTION_TOTAL;
    let remainingSlots = slots - placeholderCount;

    // 1) Groups first
    const groupPicks = [];
    for (const groupSpec of (spec.groups || [])) {
        const conditionMet =
            (groupSpec.when_config && config[groupSpec.when_config]) ||
            (groupSpec.group_type === 'DI' && config.include_quant_di);
        if (!conditionMet) continue;
        const minPassageChars =
            groupSpec.group_type === 'RC'    ? (config.rc_min_passage_chars || 0)
          : groupSpec.group_type === 'CLOZE' ? (config.cloze_min_passage_chars || 0)
          : 0;
        const picked = pickGroup(groups, groupSpec.group_type, excludedIds, {
            minSize: groupSpec.expected_size_min || 0,
            minPassageChars,
        });
        if (!picked) {
            const threshNote = minPassageChars > 0 ? ` (≥${minPassageChars} chars, ≥${groupSpec.expected_size_min} questions)` : '';
            notes.push(`[${sectionCode}] no eligible ${groupSpec.group_type} group${threshNote}; redistributing as standalone slots.`);
            continue;
        }
        groupPicks.push(picked);
        picked.members.forEach(m => excludedIds.add(m.question_id));
        remainingSlots -= picked.members.length;
    }

    // 2) Section-level difficulty deficit
    const groupMembersByLevel = countByLevel(groupPicks.flatMap(g => g.members));
    const levelDeficit = deficitFromTarget(difficultyTarget, groupMembersByLevel);

    // 3) For each requested bank subtype, pick `want` rows biased by deficit
    const standalonePicks = [];
    const shortfallByBank = [];
    for (const [bankSubtype, want] of Object.entries(bankSubtypeTargets || {})) {
        if (!Number.isInteger(want) || want <= 0) continue;
        const pool = sectionPool.filter(q => q.subtype === bankSubtype && !excludedIds.has(q.question_id));
        const { picked } = pickFromBagBiased(pool, Math.min(want, pool.length), { excludedIds, levelDeficit });
        picked.forEach(q => {
            excludedIds.add(q.question_id);
            standalonePicks.push({ ...q, _spec_subtype: bankSubtype });
        });
        const got = picked.length;
        if (got < want) shortfallByBank.push({ bank_subtype: bankSubtype, want, got });
    }

    // 4) Defensive clip if plan exceeds remainingSlots
    if (standalonePicks.length > remainingSlots) {
        notes.push(`[${sectionCode}] plan totals exceed inventory slots; dropping ${standalonePicks.length - remainingSlots} of the last picks.`);
        const dropped = standalonePicks.splice(remainingSlots);
        dropped.forEach(d => excludedIds.delete(d.question_id));
    }

    // 5) Ordering: groups first as contiguous blocks, standalones in L-ascending ramp
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

    // 6) Placeholders (config-driven first, then SHORTFALL fills for any bank_subtype gap)
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
    for (const sf of shortfallByBank) {
        notes.push(`[${sectionCode}] plan wanted ${sf.want} of "${sf.bank_subtype}", pool had ${sf.got}; ${sf.want - sf.got} slot(s) left as SHORTFALL placeholders.`);
    }

    return buildSectionResult({
        sectionCode, orderedItems, placeholders, groupPicks,
        difficultyTarget, placeholderCount: placeholders.length, notes,
    });
}

// --- shared section result builder -----------------------------------------

function buildSectionResult({
    sectionCode, orderedItems, placeholders, groupPicks,
    difficultyTarget, placeholderCount, notes,
}) {
    const drawn = orderedItems.length;
    const actual = countByLevel(orderedItems.map(o => o._picked).filter(Boolean));
    const drift = driftFromTargetActual(difficultyTarget, actual);
    const variationsUsed = new Set(orderedItems.map(o => o._picked?.subtype || o._picked?.leaf_topic_id)).size;

    const maxAbsDrift = Math.max(Math.abs(drift.L1), Math.abs(drift.L2), Math.abs(drift.L3), Math.abs(drift.L4));
    if (maxAbsDrift >= 2) {
        notes.push(`[${sectionCode}] difficulty drift from target: L1${signed(drift.L1)} L2${signed(drift.L2)} L3${signed(drift.L3)} L4${signed(drift.L4)} (pool didn't allow exact match).`);
    }

    return {
        items: orderedItems,
        placeholders,
        section_stats: {
            code: sectionCode,
            target: SECTION_TOTAL,
            drawn,
            placeholder_count: placeholderCount,
            difficulty_target: { ...difficultyTarget },
            difficulty_actual: actual,
            difficulty_drift: drift,
            // legacy field kept so older UI badge keeps rendering during rollout
            difficulty: { L2: actual.L2, L3: actual.L3, other: actual.L1 + actual.L4 },
            unique_variations: variationsUsed,
            groups_used: groupPicks.map(g => ({ group_id: g.group_id, group_type: g.group_type, size: g.members.length })),
            short: drawn + placeholderCount < SECTION_TOTAL ? (SECTION_TOTAL - drawn - placeholderCount) : 0,
        },
    };
}

function signed(n) {
    return n >= 0 ? `+${n}` : `${n}`;
}

// --- top-level entry --------------------------------------------------------

/**
 * @param {{
 *   config: any,
 *   poolsBySection: Record<'REASONING'|'GA'|'QUANT'|'ENGLISH', any[]>,
 *   groups: any[],
 *   excludedIds: Set<string>,
 *   userBankTargets?: Record<'REASONING'|'GA'|'QUANT'|'ENGLISH', Record<string, number>>,
 *   difficultyProfile?: Record<'REASONING'|'GA'|'QUANT'|'ENGLISH', {L1,L2,L3,L4}>,
 * }} args
 */
export function buildMock({ config, poolsBySection, groups, excludedIds, userBankTargets, difficultyProfile }) {
    const notes = [];
    const placeholdersFromConfig = buildPlaceholderTemplates(config);
    const placeholdersBySection = placeholderCountsBySection(config);

    // Resolve difficulty target per section. The target represents the
    // DRAWN-question count per level — i.e. (profile - placeholders absorbed).
    // For placeholders we eat into L3 first (highest base count), then L2, L4, L1.
    const sectionDifficultyTargets = {};
    for (const code of SECTION_CODES) {
        const base = difficultyProfile?.[code] || SECTION_DIFFICULTY_BASE[code];
        const target = { L1: base.L1 || 0, L2: base.L2 || 0, L3: base.L3 || 0, L4: base.L4 || 0 };
        let phLeft = placeholdersBySection[code] || 0;
        const eatOrder = ['L3', 'L2', 'L4', 'L1'];
        for (const k of eatOrder) {
            if (phLeft <= 0) break;
            const take = Math.min(target[k], phLeft);
            target[k] -= take;
            phLeft -= take;
        }
        sectionDifficultyTargets[code] = target;
    }

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
                difficultyTarget: sectionDifficultyTargets[code],
                excludedIds,
                notes,
            })
            : pickSection({
                sectionCode: code,
                sectionPool: poolsBySection[code] || [],
                groups: groups.filter(g => g.section_code === code),
                config,
                placeholderCount: placeholdersBySection[code],
                difficultyTarget: sectionDifficultyTargets[code],
                excludedIds,
                notes,
            });
        sections[code] = res;
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
        difficulty_profile: difficultyProfile || SECTION_DIFFICULTY_BASE,
    };
}
