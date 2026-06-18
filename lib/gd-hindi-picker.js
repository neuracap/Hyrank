/**
 * GD HINDI-section picker.
 *
 * Single-section helper for stage 3 of the GD bilingual workflow. Reads the
 * HINDI subset of gd-mock-spec (SECTION_SPEC.HINDI targets, HINDI subtype-
 * prefix map, HINDI bucket topics, HINDI difficulty base) and returns 20
 * question_ids drawn from the HINDI bank section, deduped against any
 * HINDI question already used in another GD mock.
 *
 * Deliberately simpler than cgl-mock-picker — only one section, no PYQ-vs-
 * bank source preference (HINDI is PYQ-only on GD), no cross-section topic
 * coordination. If config.include_hindi_cloze is set, one 5-Q CLOZE group
 * is picked (absorbing slots from hindi_comprehension).
 */

import db from './db.js';
import {
    GD_EXAM_ID,
    BANK_SECTION_IDS,
    TARGET_SECTION_IDS,
    SECTION_SPEC,
    SECTION_DIFFICULTY_BASE,
    SUBTYPE_PREFIXES,
    BUCKET_TOPICS,
    MAX_PER_TOPIC,
} from './gd-mock-spec.js';

const HINDI_TOTAL = 20;
const HINDI_SPEC_SUBTYPES = ['hindi_vocabulary', 'hindi_grammar', 'hindi_comprehension'];

function matchesPrefix(subtype, prefixes) {
    if (!subtype) return false;
    return (prefixes || []).some(p => {
        // Spec prefixes use SQL LIKE syntax with trailing %. Strip the % for JS.
        const stem = p.endsWith('%') ? p.slice(0, -1) : p;
        return subtype === stem || subtype.startsWith(stem);
    });
}

function bucketTopicFor(specSubtype, bankSubtype) {
    const topicMap = BUCKET_TOPICS[specSubtype];
    if (!topicMap) return '_other';
    for (const [topic, prefixes] of Object.entries(topicMap)) {
        if (matchesPrefix(bankSubtype, prefixes)) return topic;
    }
    return '_other';
}

/**
 * Resolves the spec_subtype bucket for a question's qv.subtype. Tries each
 * HINDI subtype's prefix list in declaration order — first match wins.
 */
function specSubtypeFor(bankSubtype) {
    for (const spec of HINDI_SPEC_SUBTYPES) {
        if (matchesPrefix(bankSubtype, SUBTYPE_PREFIXES[spec])) return spec;
    }
    return null;
}

/**
 * Picks 20 HINDI questions for a GD mock.
 *
 * @param {object} args
 * @param {string} args.mockTestId - HI companion mock_test_id (used for logging / position tagging)
 * @param {object} args.config - normalized config (only include_hindi_cloze is read)
 * @returns {Promise<{ picks: Array, shortfalls: Array, notes: Array }>}
 *   picks: [{ question_id, exam_section_id, position, slot_subtype, slot_difficulty, group_id, score }]
 *   shortfalls: [{ spec_subtype, target, picked }] when a bucket underflows
 *   notes: human-readable reasoning messages
 */
export async function pickHindiSection({ mockTestId, config = {} }) {
    const notes = [];
    const shortfalls = [];

    const hindiBankId = BANK_SECTION_IDS.HINDI;
    const hindiTargetSectionId = TARGET_SECTION_IDS.HINDI;
    const diffTarget = SECTION_DIFFICULTY_BASE.HINDI;  // { L1, L2, L3, L4 }
    const targets = { ...SECTION_SPEC.HINDI.targets };  // shallow copy — mutate locally

    // 1. Optional CLOZE group: absorbs slots from hindi_comprehension
    let groupQuestions = [];
    if (config.include_hindi_cloze) {
        const grp = await pickHindiClozeGroup();
        if (grp && grp.questions.length >= 5) {
            groupQuestions = grp.questions.slice(0, 5);
            targets.hindi_comprehension = Math.max(0, (targets.hindi_comprehension || 0) - groupQuestions.length);
            notes.push(`CLOZE group ${grp.group_id} picked (${groupQuestions.length} Qs from hindi_comprehension)`);
        } else {
            notes.push('include_hindi_cloze requested but no eligible 5-Q group found; distributing slots back to vocab/grammar');
            // Bonus slots stay in hindi_comprehension as standalone picks
        }
    }

    // 2. Pool query: HINDI bank, EN-equivalent quality filters (solution DONE,
    // answer set, not JUNK), exclude already-used HINDI qids across GD mocks.
    // Dedup note: question_usage is populated at PUBLISH time only (see
    // /api/mock-test/[id]/publish), so DRAFT/IN_REVIEW GD HI mocks won't
    // block their picks from reappearing. This matches the CGL/CHSL picker
    // behavior for consistency.
    const poolRes = await db.query(`
        SELECT qv.question_id, qv.subtype, qv.difficulty, qv.leaf_topic_id,
               qv.correct_option_label
        FROM question_version qv
        WHERE qv.exam_section_id = $2
          AND qv.language        = 'HI'
          AND qv.solution_status = 'DONE'
          AND qv.correct_option_label IS NOT NULL
          AND COALESCE(qv.status, '') NOT IN ('JUNK', 'FLAGGED')
          AND qv.subtype IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM question_usage qu
              WHERE qu.question_id = qv.question_id
                AND qu.exam_id     = $1
          )
        ORDER BY RANDOM()
    `, [GD_EXAM_ID, hindiBankId]);

    // 3. Bucket the pool by spec_subtype (and tag bucket_topic + difficulty for picking)
    const taken = new Set(groupQuestions.map(q => q.question_id));
    const poolBySpec = {
        hindi_vocabulary:    [],
        hindi_grammar:       [],
        hindi_comprehension: [],
    };
    for (const row of poolRes.rows) {
        if (taken.has(row.question_id)) continue;
        const spec = specSubtypeFor(row.subtype);
        if (!spec) continue;
        const topic = bucketTopicFor(spec, row.subtype);
        poolBySpec[spec].push({ ...row, spec_subtype: spec, bucket_topic: topic });
    }

    // 4. Pick per spec_subtype with topic round-robin + soft difficulty preference
    const remainingDiff = { ...diffTarget };  // mutable
    const picks = [];

    for (const spec of HINDI_SPEC_SUBTYPES) {
        const target = targets[spec] || 0;
        if (target <= 0) continue;

        const bucketPool = poolBySpec[spec];
        const maxPerTopic = MAX_PER_TOPIC[spec] || 2;
        const perTopicTaken = {};
        const chosen = [];

        // Pass 1: topic round-robin honouring max-per-topic + difficulty preference
        while (chosen.length < target) {
            // Score remaining candidates: prefer (a) topic with fewer picks, (b) difficulty
            // matching the largest remaining deficit.
            const candidates = bucketPool.filter(c => !taken.has(c.question_id)
                && (perTopicTaken[c.bucket_topic] || 0) < maxPerTopic);
            if (candidates.length === 0) break;

            const maxDeficitLevel = Object.entries(remainingDiff)
                .sort(([, a], [, b]) => b - a)[0]?.[0];

            candidates.sort((a, b) => {
                const aTopicCount = perTopicTaken[a.bucket_topic] || 0;
                const bTopicCount = perTopicTaken[b.bucket_topic] || 0;
                if (aTopicCount !== bTopicCount) return aTopicCount - bTopicCount;
                const aDiff = `L${a.difficulty}` === maxDeficitLevel ? 0 : 1;
                const bDiff = `L${b.difficulty}` === maxDeficitLevel ? 0 : 1;
                return aDiff - bDiff;
            });

            const pick = candidates[0];
            chosen.push(pick);
            taken.add(pick.question_id);
            perTopicTaken[pick.bucket_topic] = (perTopicTaken[pick.bucket_topic] || 0) + 1;
            const lvl = `L${pick.difficulty}`;
            if (remainingDiff[lvl] != null) remainingDiff[lvl] = Math.max(0, remainingDiff[lvl] - 1);
        }

        // Pass 2: if max-per-topic capped us short, relax that constraint
        while (chosen.length < target) {
            const candidates = bucketPool.filter(c => !taken.has(c.question_id));
            if (candidates.length === 0) break;
            const pick = candidates[0];
            chosen.push(pick);
            taken.add(pick.question_id);
        }

        if (chosen.length < target) {
            shortfalls.push({ spec_subtype: spec, target, picked: chosen.length });
            notes.push(`HINDI ${spec} underflowed: wanted ${target}, got ${chosen.length}`);
        }

        for (const c of chosen) {
            picks.push({
                question_id: c.question_id,
                exam_section_id: hindiTargetSectionId,
                slot_subtype: c.spec_subtype,
                slot_difficulty: c.difficulty,
                group_id: null,
                score: 1,
            });
        }
    }

    // Re-shuffle group questions into the front
    const groupPicks = groupQuestions.map(q => ({
        question_id: q.question_id,
        exam_section_id: hindiTargetSectionId,
        slot_subtype: 'hindi_comprehension',
        slot_difficulty: q.difficulty,
        group_id: q.group_id,
        score: 1,
    }));

    const all = [...groupPicks, ...picks].slice(0, HINDI_TOTAL);

    // Assign positions 1..20
    all.forEach((p, i) => { p.position = i + 1; });

    if (all.length < HINDI_TOTAL) {
        notes.push(`HINDI section short: filled ${all.length}/${HINDI_TOTAL}`);
    }

    return { picks: all, shortfalls, notes };
}

/**
 * Picks a single eligible HINDI CLOZE group. Returns null if none exists.
 *
 * Schema notes:
 *   - Members are joined via question_version.group_id (no separate member
 *     table). Member order is qv.group_order.
 *   - Passage text lives on the qv at qg.passage_question_id (the column
 *     question_group.passage_hi does not exist). Eligibility requires
 *     a HI passage row to exist for that qid.
 */
async function pickHindiClozeGroup() {
    const groupRes = await db.query(`
        SELECT qg.group_id
        FROM question_group qg
        WHERE qg.group_type = 'CLOZE'
          AND EXISTS (
              SELECT 1 FROM question_version pv
              WHERE pv.question_id = qg.passage_question_id
                AND pv.language = 'HI'
          )
          AND (
              SELECT COUNT(*) FROM question_version qv
              WHERE qv.group_id = qg.group_id
                AND qv.language = 'HI'
                AND qv.solution_status = 'DONE'
                AND qv.correct_option_label IS NOT NULL
                AND COALESCE(qv.status, '') NOT IN ('JUNK', 'FLAGGED')
          ) >= 5
        ORDER BY RANDOM()
        LIMIT 1
    `);

    if (groupRes.rows.length === 0) return null;
    const group_id = groupRes.rows[0].group_id;

    const memRes = await db.query(`
        SELECT qv.question_id, qv.difficulty
        FROM question_version qv
        WHERE qv.group_id = $1
          AND qv.language = 'HI'
          AND qv.solution_status = 'DONE'
          AND qv.correct_option_label IS NOT NULL
          AND COALESCE(qv.status, '') NOT IN ('JUNK', 'FLAGGED')
        ORDER BY qv.group_order ASC NULLS LAST
        LIMIT 5
    `, [group_id]);

    return {
        group_id,
        questions: memRes.rows.map(r => ({
            question_id: r.question_id,
            difficulty: r.difficulty,
            group_id,
        })),
    };
}
