// =========================================================
// Section Test generator — single-section mixed-subtype practice.
// Size = exam_section.num_questions (fallback 25).
// Subtype mix: cap-2-then-proportional (every subtype gets ≤2
//   first, then remainder distributed by pool size).
// Difficulty mix: 40 / 50 / 10 (scaled).
// Naming: "{Title-cased section code} Test N" per exam, per section.
// =========================================================

import { pickBest, checkAnswerBalance } from './mock-test-utils';

const DEFAULT_SECTION_SIZE = 25;

export class SectionTestError extends Error {
    constructor(message, { status = 500, pool_size = null } = {}) {
        super(message);
        this.status = status;
        this.pool_size = pool_size;
    }
}

function titleCaseSectionCode(code) {
    if (!code) return 'Section';
    const c = String(code).trim();
    // Short codes (GA, GS, IT) stay uppercase; longer codes get title case.
    if (c.length <= 3) return c.toUpperCase();
    return c[0].toUpperCase() + c.slice(1).toLowerCase();
}

/**
 * Cap-then-proportional subtype quota planner.
 * Each subtype gets min(cap, pool.length) first; remainder distributed
 * proportionally to (pool.length - allocated).
 */
function planSubtypeQuotas(poolBySubtype, totalSlots, cap = 2) {
    const subtypes = Object.keys(poolBySubtype);
    const quotas = Object.fromEntries(subtypes.map(st => [st, 0]));
    let allocated = 0;

    // First pass — give every subtype min(cap, pool, remaining)
    for (const st of subtypes) {
        if (allocated >= totalSlots) break;
        const room = Math.min(cap, poolBySubtype[st].length, totalSlots - allocated);
        if (room <= 0) continue;
        quotas[st] = room;
        allocated += room;
    }

    // Second pass — proportional fill, largest-remainder rounding
    let remaining = totalSlots - allocated;
    if (remaining <= 0) return quotas;

    const headroom = subtypes
        .map(st => ({ st, free: poolBySubtype[st].length - quotas[st] }))
        .filter(h => h.free > 0);
    const totalFree = headroom.reduce((s, h) => s + h.free, 0);
    if (totalFree === 0) return quotas;

    const floats = headroom.map(h => {
        const want = (h.free / totalFree) * remaining;
        return { st: h.st, want, floor: Math.floor(want), frac: want - Math.floor(want), free: h.free };
    });

    for (const f of floats) {
        const add = Math.min(f.floor, f.free);
        quotas[f.st] += add;
        remaining -= add;
    }

    floats.sort((a, b) => b.frac - a.frac);
    for (const f of floats) {
        if (remaining <= 0) break;
        if (poolBySubtype[f.st].length - quotas[f.st] > 0) {
            quotas[f.st] += 1;
            remaining -= 1;
        }
    }

    return quotas;
}

/**
 * Within a subtype quota Q, split into easy/medium/hard following 40/50/10
 * with largest-remainder rounding so it sums to Q exactly.
 */
function splitDifficultyQuota(Q) {
    if (Q <= 0) return { easy: 0, medium: 0, hard: 0 };
    const targets = { easy: Q * 0.4, medium: Q * 0.5, hard: Q * 0.1 };
    const base = {
        easy:   Math.floor(targets.easy),
        medium: Math.floor(targets.medium),
        hard:   Math.floor(targets.hard),
    };
    const remainders = [
        { k: 'medium', f: targets.medium - base.medium },
        { k: 'easy',   f: targets.easy   - base.easy   },
        { k: 'hard',   f: targets.hard   - base.hard   },
    ].sort((a, b) => b.f - a.f);
    let assigned = base.easy + base.medium + base.hard;
    let i = 0;
    while (assigned < Q) {
        base[remainders[i % remainders.length].k] += 1;
        assigned += 1;
        i += 1;
    }
    return base;
}

/**
 * Generate one Section test.
 * Caller releases the client; this function does its own BEGIN/COMMIT/ROLLBACK.
 */
export async function generateSectionTest(client, { exam_id, section_code, user_id }) {
    // 1. Find the section in this exam (defines display name + target size)
    const sectionRes = await client.query(`
        SELECT section_id, code, name, num_questions
        FROM exam_section
        WHERE exam_id = $1 AND UPPER(code) = UPPER($2)
        LIMIT 1
    `, [exam_id, section_code]);

    if (sectionRes.rows.length === 0) {
        throw new SectionTestError(
            `Section "${section_code}" not found in this exam`,
            { status: 404 }
        );
    }
    const section = sectionRes.rows[0];
    const TOTAL = section.num_questions && section.num_questions > 0
        ? section.num_questions
        : DEFAULT_SECTION_SIZE;

    // 2. Equivalent sections across exams (same code)
    const equivRes = await client.query(`
        SELECT section_id FROM exam_section WHERE UPPER(code) = UPPER($1)
    `, [section.code]);
    const allSectionIds = equivRes.rows.map(r => r.section_id);

    // 3. Next "{Section} Test N"
    const sectionTitle = titleCaseSectionCode(section.code);
    const namePattern = `^${sectionTitle} Test (\\d+)$`;
    const numRes = await client.query(`
        SELECT COALESCE(
            MAX((substring(name from $2))::int),
            0
        ) + 1 AS next_num
        FROM mock_test
        WHERE exam_id = $1
          AND test_type = 'SECTION'
          AND name ~ $3
    `, [exam_id, namePattern, namePattern]);
    const nextNum = numRes.rows[0].next_num;
    const mockName = `${sectionTitle} Test ${nextNum}`;

    // 4. SECTION-only exclusion
    const usedRes = await client.query(`
        SELECT DISTINCT question_id FROM question_usage
        WHERE exam_id = $1 AND test_type = 'SECTION'
    `, [exam_id]);
    const usedQuestionIds = new Set(usedRes.rows.map(r => r.question_id));

    const draftUsedRes = await client.query(`
        SELECT DISTINCT mtq.question_id
        FROM mock_test_question mtq
        JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
        WHERE mt.exam_id = $1
          AND mt.test_type = 'SECTION'
          AND mt.status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')
    `, [exam_id]);
    for (const r of draftUsedRes.rows) usedQuestionIds.add(r.question_id);

    // 5. Pool — every subtype in the section's union
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
          AND qv.subtype IS NOT NULL
          AND qv.language = 'EN'
          AND qv.solution_status = 'DONE'
          AND qv.difficulty IS NOT NULL
          AND qv.correct_option_label IS NOT NULL
          AND qv.correct_option_label != ''
          AND (
              es.exam_id != $2
              OR qv.paper_session_id IS NULL
          )
          AND EXISTS (
              SELECT 1 FROM question_links ql
              WHERE ql.english_question_id = qv.question_id
                 OR ql.hindi_question_id = qv.question_id
          )
    `, [allSectionIds, exam_id]);

    const pool = poolRes.rows.filter(q => !usedQuestionIds.has(q.question_id));

    if (pool.length < TOTAL) {
        throw new SectionTestError(
            `Pool too small: only ${pool.length} eligible questions for section "${section.code}" (need ${TOTAL})`,
            { status: 409, pool_size: pool.length }
        );
    }

    // 6. Group pool by subtype, plan quotas
    const poolBySubtype = {};
    for (const q of pool) {
        if (!poolBySubtype[q.subtype]) poolBySubtype[q.subtype] = [];
        poolBySubtype[q.subtype].push(q);
    }

    const subtypeQuotas = planSubtypeQuotas(poolBySubtype, TOTAL, 2);

    // 7. Fill — for each subtype quota, split into difficulty mini-quotas
    //    and pickBest within the subtype's sub-pool.
    const selectedIds = new Set();
    const selectedPaperIds = new Set();
    const answerCounts = { A: 0, B: 0, C: 0, D: 0 };
    const selections = [];
    let position = 1;

    for (const [subtype, quota] of Object.entries(subtypeQuotas)) {
        if (!quota) continue;
        const split = splitDifficultyQuota(quota);
        for (const [diff, n] of Object.entries(split)) {
            if (!n) continue;
            const slot = { subtype, preferred_difficulty: diff };
            const picked = pickBest(
                poolBySubtype[subtype],
                n,
                slot,
                selectedPaperIds,
                answerCounts,
                selectedIds
            );
            for (const p of picked) {
                selectedIds.add(p.question_id);
                if (p.paper_session_id) selectedPaperIds.add(p.paper_session_id);
                const opt = (p.correct_option_label || '').toUpperCase();
                if (answerCounts[opt] !== undefined) answerCounts[opt]++;
                selections.push({
                    question_id: p.question_id,
                    exam_section_id: section.section_id,
                    position: position++,
                    slot_subtype: subtype,
                    slot_difficulty: diff,
                    group_id: null,
                    score: Math.round((p._score || 0) * 100) / 100,
                    difficulty: p.difficulty,
                    correct_option_label: p.correct_option_label,
                    paper_session_id: p.paper_session_id,
                });
            }
        }
    }

    // If quota planning underfilled (e.g., pickBest exhausted a sub-pool
    // because adjacent-difficulty fallback was the only path), top up from
    // any unused subtypes — never give up before TOTAL.
    if (selections.length < TOTAL) {
        const need = TOTAL - selections.length;
        const fallback = pool.filter(q => !selectedIds.has(q.question_id));
        const filler = pickBest(
            fallback, need, { subtype: null, preferred_difficulty: 'medium' },
            selectedPaperIds, answerCounts, selectedIds
        );
        for (const p of filler) {
            selectedIds.add(p.question_id);
            if (p.paper_session_id) selectedPaperIds.add(p.paper_session_id);
            const opt = (p.correct_option_label || '').toUpperCase();
            if (answerCounts[opt] !== undefined) answerCounts[opt]++;
            selections.push({
                question_id: p.question_id,
                exam_section_id: section.section_id,
                position: position++,
                slot_subtype: p.subtype,
                slot_difficulty: null,
                group_id: null,
                score: Math.round((p._score || 0) * 100) / 100,
                difficulty: p.difficulty,
                correct_option_label: p.correct_option_label,
                paper_session_id: p.paper_session_id,
            });
        }
    }

    // 8. Stats
    const difficultyCounts = { easy: 0, medium: 0, hard: 0 };
    const subtypeCounts = {};
    for (const s of selections) {
        if (s.difficulty === 1) difficultyCounts.easy++;
        else if (s.difficulty === 2) difficultyCounts.medium++;
        else if (s.difficulty === 3) difficultyCounts.hard++;
        subtypeCounts[s.slot_subtype] = (subtypeCounts[s.slot_subtype] || 0) + 1;
    }

    const sectionStats = {
        code:       section.code,
        name:       section.name,
        target:     TOTAL,
        selected:   selections.length,
        pool_size:  pool.length,
        difficulty: difficultyCounts,
        subtype_distribution: subtypeCounts,
        answer_balance: checkAnswerBalance(selections),
    };

    const config_json = {
        sections: [{
            section_id: section.section_id,
            code: section.code,
            name: section.name,
            total: TOTAL,
            quotas: subtypeQuotas,
        }],
        generated_from: { type: 'SECTION', section_code: section.code, created_at: new Date().toISOString() },
    };

    // 9. Persist
    await client.query('BEGIN');
    try {
        const bpRes = await client.query(`
            INSERT INTO mock_blueprint (exam_id, name, config_json, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, true, NOW(), NOW())
            RETURNING blueprint_id
        `, [exam_id, mockName, JSON.stringify(config_json)]);
        const blueprint_id = bpRes.rows[0].blueprint_id;

        const slug = `section-${section.code.toLowerCase()}-${nextNum}-${Date.now().toString(36)}`;

        const mockRes = await client.query(`
            INSERT INTO mock_test
            (blueprint_id, exam_id, name, slug, status, test_type, stats_json, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 'DRAFT', 'SECTION', $5, $6, NOW(), NOW())
            RETURNING mock_test_id
        `, [
            blueprint_id, exam_id, mockName, slug,
            JSON.stringify({
                sections: [sectionStats],
                total_selected: selections.length,
                total_target: TOTAL,
                section: { code: section.code, name: section.name },
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
            name: mockName,
            section_code: section.code,
            section_name: section.name,
            total_selected: selections.length,
            total_target: TOTAL,
            stats: sectionStats,
        };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    }
}
