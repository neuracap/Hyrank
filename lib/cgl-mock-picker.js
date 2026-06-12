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
    BUCKET_TOPICS, MAX_PER_TOPIC, PYQ_CAP_PER_SECTION, PYQ_TARGET_PER_SECTION,
    buildPlaceholderTemplates, placeholderCountsBySection,
} from './cgl-mock-spec.js';

// Per-section PYQ-budget tracker. `target` is the active 40% goal; the helpers
// PREFER PYQ candidates over bank within a topic as long as `used < target`.
// Once `used` hits `target` (= 10), preference flips to bank for the remainder
// of the section. `cap` is the hard ceiling — when `used` reaches it, PYQ
// candidates are refused outright.
function newPyqBudget(overrides = {}) {
    return {
        used: 0,
        cap: PYQ_CAP_PER_SECTION,
        target: PYQ_TARGET_PER_SECTION,
        ...overrides,
    };
}

function isBank(q) { return (q?.source_type || 'bank') === 'bank'; }

// Within a candidate group, sort so the preferred-source rows come first.
// `prefer` = 'pyq' when we're still chasing the 40% target; 'bank' once met.
function bySourcePreference(arr, prefer) {
    return arr.slice().sort((a, b) => {
        const aPref = (isBank(a) ? 'bank' : 'pyq') === prefer ? 0 : 1;
        const bPref = (isBank(b) ? 'bank' : 'pyq') === prefer ? 0 : 1;
        return aPref - bPref;
    });
}

// Should the next pick prefer PYQ over bank? True until we've hit the target.
function preferPyq(pyqBudget) {
    return pyqBudget && pyqBudget.used < pyqBudget.target;
}

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
function pickFromBagBiased(candidates, n, { excludedIds, levelDeficit, pyqBudget = null }) {
    if (n <= 0 || candidates.length === 0) return { picked: [], remaining: candidates };
    let pool = candidates.filter(q => !excludedIds.has(q.question_id));
    if (pool.length === 0) return { picked: [], remaining: candidates };

    // Shuffle within each level; we'll re-sort by source preference at pick-time
    // (preference can flip between picks as the PYQ counter moves through `target`).
    const byDifficulty = {
        1: shuffleStable(pool.filter(q => q.difficulty === 1)),
        2: shuffleStable(pool.filter(q => q.difficulty === 2)),
        3: shuffleStable(pool.filter(q => q.difficulty === 3)),
        4: shuffleStable(pool.filter(q => q.difficulty === 4)),
    };
    const canTakePyq = () => !pyqBudget || pyqBudget.used < pyqBudget.cap;
    const picked = [];
    const usedVariationKeys = new Set();

    const acceptable = (q) => isBank(q) || canTakePyq();
    const recordPick = (q) => {
        picked.push(q);
        usedVariationKeys.add(q.subtype || q.leaf_topic_id || q.question_id);
        if (!isBank(q) && pyqBudget) pyqBudget.used++;
    };

    const pickOneAtLevel = (lvl) => {
        const bucket = byDifficulty[lvl];
        if (!bucket || bucket.length === 0) return false;
        // Re-sort by current source preference (flips when PYQ target is met).
        const preferred = preferPyq(pyqBudget) ? 'pyq' : 'bank';
        const ordered = bySourcePreference(bucket, preferred);
        const indexOf = (q) => bucket.indexOf(q);
        // First pass: preferred-source row with a fresh variation.
        for (const q of ordered) {
            const vkey = q.subtype || q.leaf_topic_id || q.question_id;
            if (!usedVariationKeys.has(vkey) && acceptable(q)) {
                bucket.splice(indexOf(q), 1);
                recordPick(q);
                return true;
            }
        }
        // Fallback: any acceptable row, still in preference order.
        for (const q of ordered) {
            if (acceptable(q)) {
                bucket.splice(indexOf(q), 1);
                recordPick(q);
                return true;
            }
        }
        return false;
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

/**
 * Topic-aware picker. Outer loop = round-robin across TOPICS; inner = pick
 * the difficulty-deficit-best row inside that topic. This is the fix for
 * within-bucket clustering: spec_subtype "arithmetic" has 8 slots, and we
 * want them spread across percentage / profit_loss / interest / ... not
 * 5 percentage_* variations.
 *
 *  topicPrefixMap: { topic_name: [bank_prefix, ...] } — first-match-wins, so each
 *                  bank subtype maps to exactly ONE topic. Unmatched → '_other'.
 *  maxPerTopic:    cap per topic; once every topic hits this, '_other' is drained,
 *                  then named topics get drained past the cap (with a clustering note).
 *
 * `levelDeficit` is MUTATED exactly like pickFromBagBiased.
 */
function pickFromTopicBucket(candidates, n, opts) {
    const { topicPrefixMap, maxPerTopic = 2, excludedIds, levelDeficit, seed = 0, pyqBudget = null } = opts;
    if (n <= 0 || candidates.length === 0) return { picked: [], remaining: candidates, topicCounts: {}, hitCap: false };
    const pool = candidates.filter(q => !excludedIds.has(q.question_id));
    if (pool.length === 0) return { picked: [], remaining: candidates, topicCounts: {}, hitCap: false };
    const canTakePyq = () => !pyqBudget || pyqBudget.used < pyqBudget.cap;

    const topicNames = Object.keys(topicPrefixMap);
    const buckets = { _other: [] };
    for (const t of topicNames) buckets[t] = [];

    for (const q of pool) {
        let placed = false;
        for (const t of topicNames) {
            for (const p of topicPrefixMap[t]) {
                const stripped = p.endsWith('%') ? p.slice(0, -1) : p;
                if (q.subtype && q.subtype.startsWith(stripped)) {
                    buckets[t].push(q);
                    placed = true;
                    break;
                }
            }
            if (placed) break;
        }
        if (!placed) buckets._other.push(q);
    }

    // Shuffle within each topic so we don't always pick the first DB-ordered row.
    // Source preference is applied at pick-time (it can flip mid-section as the
    // PYQ counter crosses `target`), so we don't pre-sort by source here.
    for (const t of Object.keys(buckets)) {
        buckets[t] = shuffleStable(buckets[t], seed + (t.length * 31));
    }

    const picked = [];
    const topicCounts = {};
    for (const t of topicNames) topicCounts[t] = 0;
    topicCounts._other = 0;

    const acceptable = (q) => isBank(q) || canTakePyq();
    const recordPick = (q, t) => {
        picked.push(q);
        topicCounts[t]++;
        if (!isBank(q) && pyqBudget) pyqBudget.used++;
    };

    const pickOneFromTopic = (t) => {
        const bucket = buckets[t];
        if (!bucket || bucket.length === 0) return false;
        // Prefer the difficulty level with largest remaining deficit; gentler ramp
        // (lower level) breaks ties. Within a level, prefer the source we're
        // chasing — PYQ until the 40% target is met, bank after.
        const levelsAvail = DIFFICULTY_LEVELS.filter(l => bucket.some(q => q.difficulty === l && acceptable(q)));
        if (levelsAvail.length === 0) return false;
        levelsAvail.sort((a, b) => {
            const da = (levelDeficit?.[`L${b}`] ?? 0) - (levelDeficit?.[`L${a}`] ?? 0);
            if (da !== 0) return da;
            return a - b;
        });
        const preferred = preferPyq(pyqBudget) ? 'pyq' : 'bank';
        for (const lvl of levelsAvail) {
            // Find the first preferred-source candidate at this level; fall back
            // to any acceptable row if the preferred source isn't represented.
            let idx = bucket.findIndex(q =>
                q.difficulty === lvl
                && acceptable(q)
                && (isBank(q) ? 'bank' : 'pyq') === preferred
            );
            if (idx < 0) {
                idx = bucket.findIndex(q => q.difficulty === lvl && acceptable(q));
            }
            if (idx >= 0) {
                const q = bucket[idx];
                bucket.splice(idx, 1);
                recordPick(q, t);
                if (levelDeficit) levelDeficit[`L${lvl}`]--;
                return true;
            }
        }
        return false;
    };

    // Randomize the topic order so the same first-named topic doesn't always lead.
    const topicOrder = shuffleStable(topicNames, seed + 7);

    // Round-robin passes: pass 1 = give each topic 1, pass 2 = give each topic a 2nd, ...
    for (let pass = 1; pass <= maxPerTopic; pass++) {
        for (const t of topicOrder) {
            if (picked.length >= n) break;
            if (topicCounts[t] >= pass) continue;
            if (buckets[t].length === 0) continue;
            pickOneFromTopic(t);
        }
        if (picked.length >= n) break;
    }

    let hitCap = false;
    // Need more — drain '_other' (unmapped subtypes) first.
    while (picked.length < n && buckets._other.length > 0) {
        pickOneFromTopic('_other');
    }
    // Still short? Drain past cap. Note this in the return for the caller to log.
    if (picked.length < n) {
        hitCap = true;
        let exhausted = false;
        while (picked.length < n && !exhausted) {
            exhausted = true;
            for (const t of topicOrder) {
                if (picked.length >= n) break;
                if (buckets[t].length > 0) {
                    pickOneFromTopic(t);
                    exhausted = false;
                }
            }
        }
    }

    const pickedIds = new Set(picked.map(q => q.question_id));
    const remaining = candidates.filter(q => !pickedIds.has(q.question_id));
    return { picked, remaining, topicCounts, hitCap };
}

// --- group picking ----------------------------------------------------------

function pickGroup(groups, groupType, excludedIds, opts = {}) {
    const { minSize = 0, maxSize = null, minPassageChars = 0, maxPassageChars = null, preferComposition = null } = opts;
    // Bank groups can have 5–17 members (RC pool varies wildly); the picker only
    // needs `maxSize` of them. Filter to groups with ≥ minSize fresh members; we
    // truncate to first `maxSize` after picking (sorted by group_order). Freshness
    // is checked on the WHOLE group — keeps the cross-mock exclusion invariant
    // (a group is "used" once any member appears in any prior CGL T1 mock).
    const candidates = groups.filter(g =>
        g.group_type === groupType &&
        g.members.length > 0 &&
        g.members.length >= minSize &&
        (g.passage_chars ?? 0) >= minPassageChars &&
        (maxPassageChars == null || (g.passage_chars ?? 0) <= maxPassageChars) &&
        g.members.every(m => !excludedIds.has(m.question_id))
    );
    if (candidates.length === 0) return null;

    let ranked;
    if (preferComposition) {
        // Soft preference: rank groups by L1-distance from the target difficulty
        // composition (e.g. RC target {L2:3, L3:2}). Passage length is the
        // tiebreak. ~1 RC group in the bank literally matches "3 L2 + 2 L3",
        // so this MUST be soft — hard filter would exhaust groups in 1 mock.
        ranked = shuffleStable(candidates).sort((a, b) => {
            const sa = compositionScore(a.members, preferComposition);
            const sb = compositionScore(b.members, preferComposition);
            if (sa !== sb) return sa - sb;
            return (b.passage_chars ?? 0) - (a.passage_chars ?? 0);
        });
    } else {
        // Default: prefer longer passages — longest wins; ties broken randomly.
        ranked = shuffleStable(candidates)
            .sort((a, b) => (b.passage_chars ?? 0) - (a.passage_chars ?? 0));
    }
    const chosen = ranked[0];
    const ordered = chosen.members
        .slice()
        .sort((a, b) => (a.group_order || 0) - (b.group_order || 0));
    let truncated;
    if (maxSize != null && ordered.length > maxSize) {
        // When the spec declares a target difficulty mix (e.g. RC: 3 L2 + 2 L3),
        // extract the subset matching it instead of just taking first N by order.
        truncated = preferComposition
            ? pickSubsetByTarget(ordered, maxSize, preferComposition)
            : ordered.slice(0, maxSize);
    } else {
        truncated = ordered;
    }
    return {
        group_id: chosen.group_id,
        group_type: chosen.group_type,
        passage_question_id: chosen.passage_question_id,
        passage_chars: chosen.passage_chars ?? null,
        members: truncated,
    };
}

/**
 * Pick a subset of size `n` from `members` whose level composition is as close
 * to `target` as possible. Used for RC groups that need to deliver 3 L2 + 2 L3
 * even when the bank group has 14 mixed-difficulty members.
 *
 * Greedy: fill each declared target level up to its `want`; pad shortfall with
 * remaining members preferring L2 → L3 → L1 → L4 (gentle ramp). Trim if the
 * target sum exceeds `n`.
 */
function pickSubsetByTarget(members, n, target) {
    const byLvl = { 1: [], 2: [], 3: [], 4: [] };
    for (const m of members) {
        if (byLvl[m.difficulty]) byLvl[m.difficulty].push(m);
    }
    // Stable group_order within each level
    for (const k of Object.keys(byLvl)) {
        byLvl[k].sort((a, b) => (a.group_order || 0) - (b.group_order || 0));
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
    return picked.slice(0, n).sort((a, b) => (a.group_order || 0) - (b.group_order || 0));
}

/**
 * Score = L1-distance from the actual subset we'd extract to the target. Used to
 * rank groups: a 14-member group with {L2:5, L3:8, L4:1} scores 0 against
 * {L2:3, L3:2} because we can carve a perfect 3+2 subset; a 14-member pure-L4
 * group scores 10.
 */
function compositionScore(members, target, n = 5) {
    const picked = pickSubsetByTarget(members.slice(), n, target);
    const counts = { L1: 0, L2: 0, L3: 0, L4: 0 };
    for (const m of picked) {
        const k = `L${m.difficulty}`;
        if (counts[k] !== undefined) counts[k]++;
    }
    return Math.abs(counts.L1 - (target.L1 || 0))
         + Math.abs(counts.L2 - (target.L2 || 0))
         + Math.abs(counts.L3 - (target.L3 || 0))
         + Math.abs(counts.L4 - (target.L4 || 0));
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
    // REASONING's `placeholderCount` becomes 5 auto-filled PYQ visuals after the
    // picker runs (the generate route does the fill). Subtract those from the
    // PYQ target so the SECTION total still lands at 40% PYQ, not 60%.
    const pyqBudget = newPyqBudget({
        target: Math.max(0, PYQ_TARGET_PER_SECTION - placeholderCount),
    });

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
        const maxPassageChars =
            groupSpec.group_type === 'RC'    ? (config.rc_max_passage_chars || null)
          : groupSpec.group_type === 'CLOZE' ? (config.cloze_max_passage_chars || null)
          : null;
        const picked = pickGroup(groups, groupSpec.group_type, excludedIds, {
            minSize: groupSpec.expected_size_min || 0,
            maxSize: groupSpec.expected_size_max || null,
            minPassageChars,
            maxPassageChars,
            preferComposition: groupSpec.prefer_composition || null,
        });
        if (!picked) {
            const rangeNote = [
                minPassageChars > 0 ? `≥${minPassageChars}` : null,
                maxPassageChars != null ? `≤${maxPassageChars}` : null,
            ].filter(Boolean).join(' & ');
            const threshNote = rangeNote ? ` (${rangeNote} chars, ≥${groupSpec.expected_size_min} questions)` : '';
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
    const protectedTargets = new Set(spec.protected_targets || []);
    const standaloneBudget = inventoryBudget;
    let placeholdersToAbsorb = placeholderCount;

    // For QUANT: DI group's 3-5 slots come OUT OF the bucket named in `di_absorbs_from`
    // (= "applied"), not split arbitrarily across all buckets via overflow.
    if (spec.di_absorbs_from && targets[spec.di_absorbs_from] !== undefined) {
        const diSize = groupPicks
            .filter(g => g.group_type === 'DI')
            .reduce((s, g) => s + g.members.length, 0);
        if (diSize > 0) {
            const before = targets[spec.di_absorbs_from];
            targets[spec.di_absorbs_from] = Math.max(0, before - diSize);
            if (before - targets[spec.di_absorbs_from] < diSize) {
                notes.push(`[${sectionCode}] DI group (${diSize} Qs) larger than "${spec.di_absorbs_from}" target (${before}); overflow will spread across other buckets.`);
            }
        }
    }

    // Rank by pool size, but NEVER trim protected_targets (e.g. ENGLISH parajumble = 2 is sacred).
    const subtypeSizeRanked = () => Object.keys(targets)
        .filter(s => !protectedTargets.has(s))
        .sort((a, b) => (subtypePools[b]?.length || 0) - (subtypePools[a]?.length || 0));

    while (placeholdersToAbsorb > 0) {
        const order = subtypeSizeRanked().filter(s => targets[s] > 0);
        if (order.length === 0) break;
        targets[order[0]]--;
        placeholdersToAbsorb--;
    }

    // Round-robin overflow trim across non-protected buckets (was: drain biggest
    // until zero, which would, e.g., trim all 7 overflow out of vocabulary).
    const targetSum = Object.values(targets).reduce((s, v) => s + v, 0);
    let overflow = targetSum - standaloneBudget;
    {
        const rrOrder = subtypeSizeRanked();
        let i = 0;
        while (overflow > 0) {
            const remaining = rrOrder.filter(s => targets[s] > 0);
            if (remaining.length === 0) break;
            targets[remaining[i % remaining.length]]--;
            overflow--;
            i++;
        }
    }

    let underflow = standaloneBudget - Object.values(targets).reduce((s, v) => s + v, 0);
    if (underflow > 0) {
        const rs = spec.remainder_subtypes || [];
        for (let i = 0; i < underflow; i++) {
            const target = rs[i % rs.length] || subtypeSizeRanked()[0];
            targets[target] = (targets[target] || 0) + 1;
        }
    }

    // 4) Pick standalones per subtype target — topic round-robin if BUCKET_TOPICS
    //    defines a topic map for this bucket, else fall back to per-bag variation pick.
    const standalonePicks = [];
    for (const specSt of Object.keys(targets)) {
        const want = targets[specSt];
        if (want <= 0) continue;
        const pool = subtypePools[specSt] || [];
        if (pool.length < want) {
            notes.push(`[${sectionCode}] subtype "${specSt}" wanted ${want}, pool has ${pool.length}; using nearest related subtype for shortfall.`);
        }

        const topicMap = BUCKET_TOPICS[specSt];
        let picked;
        if (topicMap) {
            const res = pickFromTopicBucket(pool, Math.min(want, pool.length), {
                topicPrefixMap: topicMap,
                maxPerTopic: MAX_PER_TOPIC[specSt] ?? 2,
                excludedIds, levelDeficit, pyqBudget,
            });
            picked = res.picked;
            if (res.hitCap) {
                notes.push(`[${sectionCode}] "${specSt}" exhausted per-topic cap (${MAX_PER_TOPIC[specSt] ?? 2}); drained extras to fill ${want} slots.`);
            }
        } else {
            const res = pickFromBagBiased(pool, Math.min(want, pool.length), { excludedIds, levelDeficit, pyqBudget });
            picked = res.picked;
        }

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
            const fb = pickFromBagBiased(uniq, shortfall, { excludedIds, levelDeficit, pyqBudget });
            fb.picked.forEach(p => {
                standalonePicks.push({ ...p, _spec_subtype: `${specSt}__fallback` });
                excludedIds.add(p.question_id);
            });
        }
    }

    notes.push(`[${sectionCode}] PYQ picks: ${pyqBudget.used} / target ${pyqBudget.target} (cap ${pyqBudget.cap}).`);

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
    // Same accounting as auto mode — REASONING's auto-filled visuals count as PYQ.
    const pyqBudget = newPyqBudget({
        target: Math.max(0, PYQ_TARGET_PER_SECTION - placeholderCount),
    });

    // 1) Groups first
    const groupPicks = [];
    const standalonePicks = [];
    const fallbackGroupPicks = [];   // fallback subtype picks when a group attempt fails
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
            maxSize: groupSpec.expected_size_max || null,
            minPassageChars,
            preferComposition: groupSpec.prefer_composition || null,
        });
        if (!picked) {
            const threshNote = minPassageChars > 0 ? ` (≥${minPassageChars} chars, ≥${groupSpec.expected_size_min} questions)` : '';
            // Fallback path: bank may have exhausted same-type groups across past mocks
            // (DI is the canonical example — only 8 groups in the bank). If the spec
            // declares a fallback_subtype_prefix, fill the group's slot with standalone
            // questions matching that prefix so the section still carries the right
            // flavor of question (e.g. data_interpretation_*) instead of redistributing
            // the slots silently to other buckets.
            if (groupSpec.fallback_subtype_prefix) {
                const want = groupSpec.expected_size_max || groupSpec.expected_size_min || 5;
                const fbPool = sectionPool.filter(q =>
                    q.subtype && q.subtype.startsWith(groupSpec.fallback_subtype_prefix)
                    && !excludedIds.has(q.question_id)
                    && q.group_id == null
                );
                const fbShuffled = shuffleStable(fbPool);
                const fbPicked = fbShuffled.slice(0, Math.min(want, fbShuffled.length));
                for (const q of fbPicked) {
                    excludedIds.add(q.question_id);
                    fallbackGroupPicks.push({
                        ...q,
                        _spec_subtype: `${groupSpec.group_type.toLowerCase()}_fallback`,
                    });
                }
                remainingSlots -= fbPicked.length;
                if (fbPicked.length > 0) {
                    notes.push(`[${sectionCode}] no eligible ${groupSpec.group_type} group${threshNote}; backfilled ${fbPicked.length} standalone "${groupSpec.fallback_subtype_prefix}*" slot(s).`);
                    if (fbPicked.length < want) {
                        notes.push(`[${sectionCode}] ${groupSpec.group_type} fallback short by ${want - fbPicked.length} — pool exhausted.`);
                    }
                } else {
                    notes.push(`[${sectionCode}] no eligible ${groupSpec.group_type} group${threshNote}; fallback pool also empty — slots redistribute to standalones.`);
                }
            } else {
                notes.push(`[${sectionCode}] no eligible ${groupSpec.group_type} group${threshNote}; redistributing as standalone slots.`);
            }
            continue;
        }
        groupPicks.push(picked);
        picked.members.forEach(m => excludedIds.add(m.question_id));
        remainingSlots -= picked.members.length;
    }

    // 2) Section-level difficulty deficit (groups + fallback picks both count).
    const groupMembersByLevel = countByLevel([
        ...groupPicks.flatMap(g => g.members),
        ...fallbackGroupPicks,
    ]);
    const levelDeficit = deficitFromTarget(difficultyTarget, groupMembersByLevel);

    // 3) For each requested bank subtype, pick `want` rows biased by deficit
    const shortfallByBank = [];
    fallbackGroupPicks.forEach(q => standalonePicks.push(q));
    for (const [bankSubtype, want] of Object.entries(bankSubtypeTargets || {})) {
        if (!Number.isInteger(want) || want <= 0) continue;
        const pool = sectionPool.filter(q => q.subtype === bankSubtype && !excludedIds.has(q.question_id));
        const { picked } = pickFromBagBiased(pool, Math.min(want, pool.length), { excludedIds, levelDeficit, pyqBudget });
        picked.forEach(q => {
            excludedIds.add(q.question_id);
            standalonePicks.push({ ...q, _spec_subtype: bankSubtype });
        });
        const got = picked.length;
        if (got < want) shortfallByBank.push({ bank_subtype: bankSubtype, want, got });
    }

    notes.push(`[${sectionCode}] PYQ picks: ${pyqBudget.used} / target ${pyqBudget.target} (cap ${pyqBudget.cap}).`);

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
