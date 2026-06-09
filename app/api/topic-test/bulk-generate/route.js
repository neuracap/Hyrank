import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { generateTopicTest, TopicTestError, TOPIC_TOTAL } from '@/lib/topic-test-generator';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_MAX_PER_SUBTYPE = 3;

/**
 * POST /api/topic-test/bulk-generate
 * Body: { exam_id, max_per_subtype? = 3 }
 *
 * For each eligible subtype, generate up to `max_per_subtype` Topic tests in
 * sequence. Each generation consumes 20 questions and shrinks the next
 * iteration's pool via the TOPIC exclusion filter.
 *
 * Response: {
 *   success, total_created, total_skipped,
 *   created: [{ subtype, mocks: [{ mock_test_id, name, ... }] }],
 *   skipped: [{ subtype, reason }]
 * }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { exam_id, max_per_subtype } = await req.json();
    if (!exam_id) {
        return NextResponse.json({ error: 'exam_id is required' }, { status: 400 });
    }
    const cap = Math.max(1, Math.min(10, parseInt(max_per_subtype, 10) || DEFAULT_MAX_PER_SUBTYPE));

    const client = await db.connect();
    try {
        // Discover eligible subtypes for this exam (codes mapped across exams,
        // already-locked TOPIC questions excluded).
        const codesRes = await client.query(`
            SELECT DISTINCT UPPER(code) AS code FROM exam_section WHERE exam_id = $1
        `, [exam_id]);
        const codes = codesRes.rows.map(r => r.code);
        if (codes.length === 0) {
            client.release();
            return NextResponse.json({ error: 'Exam has no sections' }, { status: 404 });
        }

        const sectionsRes = await client.query(`
            SELECT section_id FROM exam_section WHERE UPPER(code) = ANY($1)
        `, [codes]);
        const allSectionIds = sectionsRes.rows.map(r => r.section_id);

        const subRes = await client.query(`
            SELECT qv.subtype, COUNT(*) AS cnt
            FROM question_version qv
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE qv.exam_section_id = ANY($1)
              AND qv.language = 'EN'
              AND qv.solution_status = 'DONE'
              AND qv.subtype IS NOT NULL
              AND qv.difficulty IS NOT NULL
              AND qv.correct_option_label IS NOT NULL
              AND qv.correct_option_label != ''
              AND (es.exam_id != $2 OR qv.paper_session_id IS NULL)
              AND EXISTS (
                  SELECT 1 FROM question_links ql
                  WHERE ql.english_question_id = qv.question_id
                     OR ql.hindi_question_id = qv.question_id
              )
              AND qv.question_id NOT IN (
                  SELECT question_id FROM question_usage
                  WHERE exam_id = $2 AND test_type = 'TOPIC'
              )
              AND qv.question_id NOT IN (
                  SELECT mtq.question_id FROM mock_test_question mtq
                  JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
                  WHERE mt.exam_id = $2 AND mt.test_type = 'TOPIC'
                    AND mt.status IN ('DRAFT','IN_REVIEW','APPROVED')
              )
            GROUP BY qv.subtype
            ORDER BY cnt DESC, qv.subtype ASC
        `, [allSectionIds, exam_id]);

        const created = [];
        const skipped = [];

        for (const row of subRes.rows) {
            const subtype = row.subtype;
            const startingPool = parseInt(row.cnt, 10);
            const mocks = [];

            // Estimate how many tests this subtype can yield up-front for skip messaging.
            const naivePossible = Math.floor(startingPool / TOPIC_TOTAL);

            if (naivePossible === 0) {
                skipped.push({
                    subtype,
                    reason: `Pool ${startingPool} < ${TOPIC_TOTAL}`,
                });
                continue;
            }

            for (let i = 0; i < cap; i++) {
                try {
                    const r = await generateTopicTest(client, {
                        exam_id, subtype, user_id: user.id,
                    });
                    mocks.push({
                        mock_test_id: r.mock_test_id,
                        name: r.name,
                        section_code: r.section_code,
                        difficulty: r.stats?.difficulty,
                    });
                } catch (e) {
                    if (e instanceof TopicTestError && e.status === 409) {
                        // Pool drained mid-loop; stop and continue with next subtype.
                        if (i === 0) {
                            skipped.push({
                                subtype,
                                reason: e.message,
                            });
                        }
                        break;
                    }
                    // Hard error — surface it but don't abort the bulk run.
                    skipped.push({
                        subtype,
                        reason: `Generation error after ${i} tests: ${e.message}`,
                    });
                    break;
                }
            }

            if (mocks.length > 0) {
                created.push({ subtype, count: mocks.length, mocks });
            }
        }

        const total_created = created.reduce((s, c) => s + c.count, 0);

        return NextResponse.json({
            success: true,
            total_created,
            total_skipped: skipped.length,
            cap_per_subtype: cap,
            created,
            skipped,
        });

    } catch (e) {
        console.error('topic-test/bulk-generate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
