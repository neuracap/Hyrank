import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { pickBest, checkAnswerBalance } from '@/lib/mock-test-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DIFFICULTY_SLOTS = [
    { preferred_difficulty: 'easy',   count: 8 },
    { preferred_difficulty: 'medium', count: 10 },
    { preferred_difficulty: 'hard',   count: 2 },
];
const TOTAL = DIFFICULTY_SLOTS.reduce((s, x) => s + x.count, 0);

/**
 * POST /api/topic-test/create
 * Create + generate a single-subtype topic test in one shot.
 * Body: { exam_id, subtype }
 * Output is a 20-question test (8 easy / 10 medium / 2 hard) named "Topic N",
 * where N auto-increments per exam.
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { exam_id, subtype } = await req.json();
    if (!exam_id || !subtype) {
        return NextResponse.json({ error: 'exam_id and subtype are required' }, { status: 400 });
    }

    const client = await db.connect();

    try {
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
            client.release();
            return NextResponse.json(
                { error: `No section found in this exam carrying subtype "${subtype}"` },
                { status: 404 }
            );
        }

        const targetSection = sectionPickRes.rows[0];

        // 2. Gather equivalent sections across all exams (same code) for a wider pool,
        //    matching the rules used by /api/mock-test/generate.
        const equivSectionsRes = await client.query(`
            SELECT section_id, exam_id, code
            FROM exam_section
            WHERE UPPER(code) = UPPER($1)
        `, [targetSection.code]);

        const allSectionIds = equivSectionsRes.rows.map(s => s.section_id);

        // 3. Compute next "Topic N" name (per exam)
        const numRes = await client.query(`
            SELECT COALESCE(
                MAX((substring(name from '^Topic (\\d+)$'))::int),
                0
            ) + 1 AS next_num
            FROM mock_test
            WHERE exam_id = $1
              AND name ~ '^Topic \\d+$'
        `, [exam_id]);
        const nextNum = numRes.rows[0].next_num;
        const mockName = `Topic ${nextNum}`;

        // 4. Build config_json
        const config_json = {
            sections: [{
                section_id: targetSection.section_id,
                code:       targetSection.code,
                name:       targetSection.name,
                total:      TOTAL,
                topic_slots: DIFFICULTY_SLOTS.map(s => ({
                    subtype,
                    count: s.count,
                    preferred_difficulty: s.preferred_difficulty,
                })),
            }],
            generated_from: {
                type:    'TOPIC',
                subtype,
                created_at: new Date().toISOString(),
            },
        };

        // 5. Used-question exclusion (same rules as /api/mock-test/generate)
        const usedRes = await client.query(`
            SELECT DISTINCT question_id FROM question_usage WHERE exam_id = $1
        `, [exam_id]);
        const usedQuestionIds = new Set(usedRes.rows.map(r => r.question_id));

        const draftUsedRes = await client.query(`
            SELECT DISTINCT mtq.question_id
            FROM mock_test_question mtq
            JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
            WHERE mt.exam_id = $1 AND mt.status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')
        `, [exam_id]);
        for (const r of draftUsedRes.rows) usedQuestionIds.add(r.question_id);

        // 6. Fetch the candidate pool for this subtype
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

        if (pool.length < TOTAL) {
            client.release();
            return NextResponse.json({
                error: `Pool too small: only ${pool.length} eligible questions for subtype "${subtype}" (need ${TOTAL})`,
                pool_size: pool.length,
            }, { status: 409 });
        }

        // 7. Fill the 3 difficulty slots
        const selectedIds = new Set();
        const selectedPaperIds = new Set();
        const answerCounts = { A: 0, B: 0, C: 0, D: 0 };
        const selections = [];
        let position = 1;

        for (const slotSpec of DIFFICULTY_SLOTS) {
            const slot = { subtype, ...slotSpec };
            const picked = pickBest(
                pool,
                slot.count,
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
        const answerCheck = checkAnswerBalance(selections);

        const sectionStats = {
            code:       targetSection.code,
            name:       targetSection.name,
            target:     TOTAL,
            selected:   selections.length,
            pool_size:  pool.length,
            difficulty: difficultyCounts,
            answer_balance: answerCheck,
        };

        // 8. Persist blueprint + mock_test + questions in one transaction
        await client.query('BEGIN');

        const bpRes = await client.query(`
            INSERT INTO mock_blueprint (exam_id, name, config_json, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, true, NOW(), NOW())
            RETURNING blueprint_id
        `, [exam_id, mockName, JSON.stringify(config_json)]);
        const blueprint_id = bpRes.rows[0].blueprint_id;

        const slug = `topic-${nextNum}-${Date.now().toString(36)}`;

        const mockRes = await client.query(`
            INSERT INTO mock_test
            (blueprint_id, exam_id, name, slug, status, stats_json, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, NOW(), NOW())
            RETURNING mock_test_id
        `, [
            blueprint_id,
            exam_id,
            mockName,
            slug,
            JSON.stringify({
                sections: [sectionStats],
                total_selected: selections.length,
                total_target:   TOTAL,
                topic: { subtype, difficulty_mix: { easy: 8, medium: 10, hard: 2 } },
            }),
            user.id,
        ]);
        const mock_test_id = mockRes.rows[0].mock_test_id;

        for (const sel of selections) {
            await client.query(`
                INSERT INTO mock_test_question
                (mock_test_id, question_id, exam_section_id, position,
                 slot_subtype, slot_difficulty, review_status, group_id, score, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, NOW())
            `, [
                mock_test_id,
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
            mock_test_id,
            blueprint_id,
            name: mockName,
            subtype,
            section_code: targetSection.code,
            total_selected: selections.length,
            total_target:   TOTAL,
            stats: sectionStats,
        });

    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('topic-test/create error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
