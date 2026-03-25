import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { pickBest, checkDifficultyDistribution, checkAnswerBalance } from '@/lib/mock-test-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/mock-test/generate
 * Generate a draft mock test from a blueprint.
 * Body: { blueprint_id, name? }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { blueprint_id, name } = await req.json();
    if (!blueprint_id) {
        return NextResponse.json({ error: 'blueprint_id is required' }, { status: 400 });
    }

    const client = await db.connect();

    try {
        // 1. Load blueprint
        const bpRes = await client.query(`
            SELECT b.*, e.name AS exam_name
            FROM mock_blueprint b
            LEFT JOIN exam e ON e.exam_id = b.exam_id
            WHERE b.blueprint_id = $1
        `, [blueprint_id]);

        if (bpRes.rows.length === 0) {
            client.release();
            return NextResponse.json({ error: 'Blueprint not found' }, { status: 404 });
        }

        const blueprint = bpRes.rows[0];
        const config = typeof blueprint.config_json === 'string'
            ? JSON.parse(blueprint.config_json)
            : blueprint.config_json;
        const targetExamId = blueprint.exam_id;

        // 2. Get question_ids already used for this exam (across all test types)
        const usedRes = await client.query(`
            SELECT DISTINCT question_id FROM question_usage WHERE exam_id = $1
        `, [targetExamId]);
        const usedQuestionIds = new Set(usedRes.rows.map(r => r.question_id));

        // Also exclude questions in current draft/in-review mocks for this exam
        const draftUsedRes = await client.query(`
            SELECT DISTINCT mtq.question_id
            FROM mock_test_question mtq
            JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
            WHERE mt.exam_id = $1 AND mt.status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')
        `, [targetExamId]);
        for (const r of draftUsedRes.rows) usedQuestionIds.add(r.question_id);

        // 3. Process each section
        const allSelections = [];
        const sectionStats = [];

        for (const section of config.sections) {
            // Find all equivalent sections (same code across all exams)
            const equivSectionsRes = await client.query(`
                SELECT section_id, exam_id, code
                FROM exam_section
                WHERE UPPER(code) = UPPER($1)
            `, [section.code]);

            const targetSectionIds = equivSectionsRes.rows
                .filter(s => s.exam_id === targetExamId)
                .map(s => s.section_id);
            const otherSectionIds = equivSectionsRes.rows
                .filter(s => s.exam_id !== targetExamId)
                .map(s => s.section_id);
            const allSectionIds = [...targetSectionIds, ...otherSectionIds];

            if (allSectionIds.length === 0) {
                sectionStats.push({ code: section.code, error: 'No matching sections found' });
                continue;
            }

            // 4. Fetch eligible question pool for this section
            //    - From same exam: only non-PYQ (paper_session_id IS NULL)
            //    - From other exams: PYQs are fine
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
                  AND qv.language = 'EN'
                  AND qv.solution_status = 'DONE'
                  AND qv.subtype IS NOT NULL
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
                ORDER BY qv.subtype, qv.difficulty
            `, [allSectionIds, targetExamId]);

            // Filter out already-used questions
            const pool = poolRes.rows.filter(q => !usedQuestionIds.has(q.question_id));

            // 5. Fill topic slots
            const selectedIds = new Set();
            const selectedPaperIds = new Set();
            const answerCounts = { A: 0, B: 0, C: 0, D: 0 };
            const sectionSelections = [];

            // Group pool by subtype for faster lookup
            const poolBySubtype = {};
            for (const q of pool) {
                if (!poolBySubtype[q.subtype]) poolBySubtype[q.subtype] = [];
                poolBySubtype[q.subtype].push(q);
            }

            let position = 1;

            // Fill group slots first (RC, Cloze, DI)
            for (const group of (section.groups || [])) {
                for (let gi = 0; gi < (group.group_count || 1); gi++) {
                    // Find question groups of this type within eligible sections
                    const groupRes = await client.query(`
                        SELECT DISTINCT qv.group_id,
                               COUNT(*) AS q_count
                        FROM question_version qv
                        JOIN exam_section es ON es.section_id = qv.exam_section_id
                        WHERE qv.exam_section_id = ANY($1)
                          AND qv.group_id IS NOT NULL
                          AND qv.language = 'EN'
                          AND qv.solution_status = 'DONE'
                          AND (es.exam_id != $2 OR qv.paper_session_id IS NULL)
                        GROUP BY qv.group_id
                        HAVING COUNT(*) >= $3
                        ORDER BY RANDOM()
                        LIMIT 5
                    `, [allSectionIds, targetExamId, group.question_count || 5]);

                    // Pick the first group whose questions aren't already used
                    for (const gRow of groupRes.rows) {
                        const gqRes = await client.query(`
                            SELECT qv.question_id, qv.version_no, qv.subtype,
                                   qv.difficulty, qv.correct_option_label,
                                   qv.paper_session_id, qv.is_verified
                            FROM question_version qv
                            WHERE qv.group_id = $1 AND qv.language = 'EN'
                            ORDER BY qv.group_order NULLS LAST
                            LIMIT $2
                        `, [gRow.group_id, group.question_count || 5]);

                        const groupQs = gqRes.rows.filter(q =>
                            !usedQuestionIds.has(q.question_id) && !selectedIds.has(q.question_id)
                        );

                        if (groupQs.length >= (group.question_count || 5)) {
                            for (const gq of groupQs.slice(0, group.question_count || 5)) {
                                selectedIds.add(gq.question_id);
                                if (gq.paper_session_id) selectedPaperIds.add(gq.paper_session_id);
                                const opt = (gq.correct_option_label || '').toUpperCase();
                                if (answerCounts[opt] !== undefined) answerCounts[opt]++;

                                sectionSelections.push({
                                    question_id: gq.question_id,
                                    exam_section_id: section.section_id,
                                    position: position++,
                                    slot_subtype: group.group_type,
                                    slot_difficulty: null,
                                    group_id: gRow.group_id,
                                    score: 10,
                                    difficulty: gq.difficulty,
                                    correct_option_label: gq.correct_option_label,
                                    paper_session_id: gq.paper_session_id,
                                });
                            }
                            break; // found a valid group
                        }
                    }
                }
            }

            // Fill individual topic slots
            const groupQuestionCount = sectionSelections.length;
            const remainingSlots = (section.topic_slots || []).slice();

            for (const slot of remainingSlots) {
                const subtypePool = (poolBySubtype[slot.subtype] || [])
                    .filter(q => !selectedIds.has(q.question_id));

                const picked = pickBest(
                    subtypePool,
                    slot.count || 1,
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

                    sectionSelections.push({
                        question_id: p.question_id,
                        exam_section_id: section.section_id,
                        position: position++,
                        slot_subtype: slot.subtype,
                        slot_difficulty: slot.preferred_difficulty || null,
                        group_id: null,
                        score: Math.round((p._score || 0) * 100) / 100,
                        difficulty: p.difficulty,
                        correct_option_label: p.correct_option_label,
                        paper_session_id: p.paper_session_id,
                    });
                }
            }

            // Section stats
            const diffCheck = checkDifficultyDistribution(
                sectionSelections,
                section.difficulty_target
            );
            const ansCheck = checkAnswerBalance(sectionSelections);

            sectionStats.push({
                code: section.code,
                name: section.name,
                target: section.total,
                selected: sectionSelections.length,
                group_questions: groupQuestionCount,
                pool_size: pool.length,
                difficulty: diffCheck,
                answer_balance: ansCheck,
            });

            allSelections.push(...sectionSelections);
        }

        // 6. Create mock_test and mock_test_question records
        const totalSelected = allSelections.length;
        const totalTarget = config.sections.reduce((s, sec) => s + (sec.total || 25), 0);

        const mockName = name ||
            `${blueprint.exam_name || 'Mock'} Test — ${new Date().toISOString().slice(0, 10)}`;
        const slug = mockName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        await client.query('BEGIN');

        const mockRes = await client.query(`
            INSERT INTO mock_test
            (blueprint_id, exam_id, name, slug, status, stats_json, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, NOW(), NOW())
            RETURNING mock_test_id
        `, [
            blueprint_id,
            targetExamId,
            mockName,
            slug + '-' + Date.now().toString(36),
            JSON.stringify({ sections: sectionStats, total_selected: totalSelected, total_target: totalTarget }),
            user.id,
        ]);

        const mockTestId = mockRes.rows[0].mock_test_id;

        // Insert all selected questions
        for (const sel of allSelections) {
            await client.query(`
                INSERT INTO mock_test_question
                (mock_test_id, question_id, exam_section_id, position,
                 slot_subtype, slot_difficulty, review_status, group_id, score, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, NOW())
            `, [
                mockTestId,
                sel.question_id,
                sel.exam_section_id,
                sel.position,
                sel.slot_subtype,
                sel.slot_difficulty,
                sel.group_id,
                sel.score,
            ]);
        }

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            mock_test_id: mockTestId,
            name: mockName,
            total_selected: totalSelected,
            total_target: totalTarget,
            sections: sectionStats,
        });

    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('mock-test/generate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
