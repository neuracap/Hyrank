// =========================================================
// Topic Test generator — single-subtype 20Q drill, shared across exams.
//   Level 1 ("A"): 40 / 50 / 10  — GD, MTS feel
//   Level 2 ("B"): 10 / 60 / 30  — CGL, banking-prelim feel
//   Level 3 ("C"):  0 / 30 / 70  — CPO, CHSL, banking-mains feel
// Naming: "Topic A{N}" / "Topic B{N}" / "Topic C{N}" — counter
// scoped to (test_type='TOPIC', difficulty_level=L), global across exams.
//
// Question_usage and DRAFT/IN_REVIEW/APPROVED exclusion is keyed on
// (test_type, difficulty_level) — exam-agnostic. exam_id on mock_test
// is preserved as audit-only (records the generating admin's context).
// =========================================================

import { pickBest, checkAnswerBalance } from './mock-test-utils';

export const TOPIC_TOTAL = 20;

export const LEVEL_LETTERS = { 1: 'A', 2: 'B', 3: 'C' };
export const LEVEL_MIXES = {
    1: { easy: 0.4, medium: 0.5, hard: 0.1 },
    2: { easy: 0.1, medium: 0.6, hard: 0.3 },
    3: { easy: 0.0, medium: 0.3, hard: 0.7 },
};

export class TopicTestError extends Error {
    constructor(message, { status = 500, pool_size = null } = {}) {
        super(message);
        this.status = status;
        this.pool_size = pool_size;
    }
}

function buildTopicSlots(level) {
    const mix = LEVEL_MIXES[level];
    if (!mix) throw new TopicTestError(`Invalid difficulty_level ${level}`, { status: 400 });
    const easy   = Math.round(TOPIC_TOTAL * mix.easy);
    const medium = Math.round(TOPIC_TOTAL * mix.medium);
    const hard   = TOPIC_TOTAL - easy - medium;
    return [
        { preferred_difficulty: 'easy',   count: easy   },
        { preferred_difficulty: 'medium', count: medium },
        { preferred_difficulty: 'hard',   count: hard   },
    ].filter(s => s.count > 0);
}

/**
 * Generate one Topic test for { exam_id, subtype, difficulty_level }.
 * exam_id determines section context + audit tag; the test is then visible
 * to every exam whose profile includes this level.
 */
export async function generateTopicTest(client, { exam_id, subtype, difficulty_level, user_id }) {
    const level = parseInt(difficulty_level, 10);
    if (![1, 2, 3].includes(level)) {
        throw new TopicTestError('difficulty_level must be 1, 2 or 3', { status: 400 });
    }
    const slots = buildTopicSlots(level);

    // 1. Pick the section in this exam where this subtype is most common
    const sectionPickRes = await client.query(`
        SELECT es.section_id, es.code, es.name, COUNT(*) AS cnt
        FROM exam_section es
        JOIN question_version qv ON qv.exam_section_id = es.section_id
        WHERE es.exam_id = $1
          AND qv.subtype = $2
          AND qv.language = 'EN'
          AND qv.status = 'MANUALLY_CORRECTED'
        GROUP BY es.section_id, es.code, es.name
        ORDER BY cnt DESC
        LIMIT 1
    `, [exam_id, subtype]);

    if (sectionPickRes.rows.length === 0) {
        throw new TopicTestError(
            `No section found in this exam carrying subtype "${subtype}"`,
            { status: 404 }
        );
    }
    const targetSection = sectionPickRes.rows[0];

    // 2. Equivalent sections across exams (for the question pool)
    const equivSectionsRes = await client.query(`
        SELECT section_id, exam_id, code
        FROM exam_section
        WHERE UPPER(code) = UPPER($1)
    `, [targetSection.code]);
    const allSectionIds = equivSectionsRes.rows.map(s => s.section_id);

    // 3. Next "Topic {letter}{N}" — counter is global per (test_type, level)
    const letter = LEVEL_LETTERS[level];
    const namePattern = `^Topic ${letter}\\d+$`;
    const numRes = await client.query(`
        SELECT COALESCE(
            MAX((substring(name from $1))::int),
            0
        ) + 1 AS next_num
        FROM mock_test
        WHERE test_type = 'TOPIC'
          AND difficulty_level = $2
          AND name ~ $3
    `, [`^Topic ${letter}(\\d+)$`, level, namePattern]);
    const nextNum = numRes.rows[0].next_num;
    const mockName = `Topic ${letter}${nextNum}`;

    // 4. Config snapshot
    const config_json = {
        sections: [{
            section_id: targetSection.section_id,
            code:       targetSection.code,
            name:       targetSection.name,
            total:      TOPIC_TOTAL,
            topic_slots: slots.map(s => ({
                subtype, count: s.count,
                preferred_difficulty: s.preferred_difficulty,
            })),
        }],
        generated_from: {
            type: 'TOPIC',
            subtype,
            difficulty_level: level,
            origin_exam_id: exam_id,
            created_at: new Date().toISOString(),
        },
    };

    // 5. Exclusion — global per (test_type, level), NOT per exam
    const usedRes = await client.query(`
        SELECT DISTINCT question_id FROM question_usage
        WHERE test_type = 'TOPIC' AND difficulty_level = $1
    `, [level]);
    const usedQuestionIds = new Set(usedRes.rows.map(r => r.question_id));

    const draftUsedRes = await client.query(`
        SELECT DISTINCT mtq.question_id
        FROM mock_test_question mtq
        JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
        WHERE mt.test_type = 'TOPIC'
          AND mt.difficulty_level = $1
          AND mt.status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')
    `, [level]);
    for (const r of draftUsedRes.rows) usedQuestionIds.add(r.question_id);

    // 6. Pool — cross-exam union by section code, eligible questions only
    const poolRes = await client.query(`
        SELECT
            qv.question_id, qv.version_no, qv.language,
            qv.subtype, qv.difficulty, qv.correct_option_label,
            qv.paper_session_id, qv.is_verified,
            qv.exam_section_id,
            es.exam_id AS source_exam_id,
            COALESCE(
                (qv.solution_json->'quality_check'->>'issue_flag')::boolean,
                false
            ) AS issue_flag
        FROM question_version qv
        JOIN exam_section es ON es.section_id = qv.exam_section_id
        WHERE qv.exam_section_id = ANY($1)
          AND qv.subtype = $2
          AND qv.language = 'EN'
          AND qv.solution_status = 'DONE'
          AND qv.difficulty IS NOT NULL
          AND qv.correct_option_label IS NOT NULL
          AND qv.correct_option_label != ''
          AND (
              es.exam_id != $3
              OR qv.paper_session_id IS NULL
          )
          AND EXISTS (
              SELECT 1 FROM question_links ql
              WHERE ql.english_question_id = qv.question_id
                 OR ql.hindi_question_id = qv.question_id
          )
    `, [allSectionIds, subtype, exam_id]);

    const pool = poolRes.rows.filter(q => !usedQuestionIds.has(q.question_id));

    if (pool.length < TOPIC_TOTAL) {
        throw new TopicTestError(
            `Pool too small: only ${pool.length} eligible questions for subtype "${subtype}" at level ${level} (need ${TOPIC_TOTAL})`,
            { status: 409, pool_size: pool.length }
        );
    }

    // 7. Fill slots
    const selectedIds = new Set();
    const selectedPaperIds = new Set();
    const answerCounts = { A: 0, B: 0, C: 0, D: 0 };
    const selections = [];
    let position = 1;

    for (const slotSpec of slots) {
        const slot = { subtype, ...slotSpec };
        const picked = pickBest(pool, slot.count, slot, selectedPaperIds, answerCounts, selectedIds);

        for (const p of picked) {
            selectedIds.add(p.question_id);
            if (p.paper_session_id) selectedPaperIds.add(p.paper_session_id);
            const opt = (p.correct_option_label || '').toUpperCase();
            if (answerCounts[opt] !== undefined) answerCounts[opt]++;

            selections.push({
                question_id: p.question_id,
                exam_section_id: targetSection.section_id,
                position: position++,
                slot_subtype: subtype,
                slot_difficulty: slot.preferred_difficulty,
                group_id: null,
                score: Math.round((p._score || 0) * 100) / 100,
                difficulty: p.difficulty,
                correct_option_label: p.correct_option_label,
                paper_session_id: p.paper_session_id,
            });
        }
    }

    const difficultyCounts = { easy: 0, medium: 0, hard: 0 };
    for (const s of selections) {
        if (s.difficulty === 1) difficultyCounts.easy++;
        else if (s.difficulty === 2) difficultyCounts.medium++;
        else if (s.difficulty === 3) difficultyCounts.hard++;
    }
    const sectionStats = {
        code:       targetSection.code,
        name:       targetSection.name,
        target:     TOPIC_TOTAL,
        selected:   selections.length,
        pool_size:  pool.length,
        difficulty: difficultyCounts,
        answer_balance: checkAnswerBalance(selections),
    };

    // 8. Persist
    await client.query('BEGIN');
    try {
        const bpRes = await client.query(`
            INSERT INTO mock_blueprint (exam_id, name, config_json, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, true, NOW(), NOW())
            RETURNING blueprint_id
        `, [exam_id, mockName, JSON.stringify(config_json)]);
        const blueprint_id = bpRes.rows[0].blueprint_id;

        const slug = `topic-${letter.toLowerCase()}${nextNum}-${Date.now().toString(36)}`;

        const mockRes = await client.query(`
            INSERT INTO mock_test
            (blueprint_id, exam_id, name, slug, status, test_type, difficulty_level,
             stats_json, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 'DRAFT', 'TOPIC', $5, $6, $7, NOW(), NOW())
            RETURNING mock_test_id
        `, [
            blueprint_id, exam_id, mockName, slug, level,
            JSON.stringify({
                sections: [sectionStats],
                total_selected: selections.length,
                total_target: TOPIC_TOTAL,
                topic: { subtype, level, difficulty_mix: LEVEL_MIXES[level] },
            }),
            user_id,
        ]);
        const mock_test_id = mockRes.rows[0].mock_test_id;

        for (const sel of selections) {
            await client.query(`
                INSERT INTO mock_test_question
                (mock_test_id, question_id, exam_section_id, position,
                 slot_subtype, slot_difficulty, review_status, group_id, score, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, NOW())
            `, [
                mock_test_id, sel.question_id, sel.exam_section_id, sel.position,
                sel.slot_subtype, sel.slot_difficulty, sel.group_id, sel.score,
            ]);
        }

        await client.query('COMMIT');

        return {
            mock_test_id, blueprint_id,
            name: mockName, subtype,
            difficulty_level: level,
            section_code: targetSection.code,
            total_selected: selections.length,
            total_target: TOPIC_TOTAL,
            stats: sectionStats,
        };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    }
}
