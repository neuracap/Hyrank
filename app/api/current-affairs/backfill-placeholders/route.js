import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import {
    CGL_T1_EXAM_ID, TARGET_SECTION_IDS, CA_FRESHNESS_QUARTERS_DEFAULT,
} from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/current-affairs/backfill-placeholders
 *
 * Body (optional): {
 *   mock_test_id?: string,      // restrict to one mock; omit to do all CGL T1
 *   ca_freshness_quarters?: int,
 *   dry_run?: boolean,
 * }
 *
 * Walks CGL T1 mock_test rows; for each stats_json.placeholders entry whose
 * placeholder_id starts with PLACEHOLDER_GA_CA, picks a fresh approved CA from
 * question_version (not yet used in any CGL T1 mock), INSERTs a
 * mock_test_question row at the placeholder's position, and prunes the entry
 * out of stats_json.placeholders.
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const onlyMockId = body.mock_test_id || null;
    const freshnessQuarters = Math.max(1, Math.min(20,
        parseInt(body.ca_freshness_quarters ?? CA_FRESHNESS_QUARTERS_DEFAULT, 10) || CA_FRESHNESS_QUARTERS_DEFAULT
    ));
    const dryRun = !!body.dry_run;

    const now = new Date();
    const currentYq = now.getFullYear() * 4 + (Math.floor(now.getMonth() / 3) + 1);
    const caCutoffYq = currentYq - freshnessQuarters;
    const gaTargetId = TARGET_SECTION_IDS.GA;

    const client = await db.connect();
    try {
        // 1. Load CGL T1 mocks (optionally just one)
        const mocksRes = onlyMockId
            ? await client.query(
                `SELECT mock_test_id, stats_json FROM mock_test
                 WHERE exam_id = $1 AND mock_test_id = $2`,
                [CGL_T1_EXAM_ID, onlyMockId])
            : await client.query(
                `SELECT mock_test_id, stats_json FROM mock_test WHERE exam_id = $1`,
                [CGL_T1_EXAM_ID]);

        // 2. Build the pool of approved + fresh CA question_ids, minus those
        //    already used in any CGL T1 mock.
        const poolRes = await client.query(`
            SELECT qv.question_id, qv.subtype, qv.difficulty
            FROM question_version qv
            WHERE qv.source_type='bank' AND qv.question_type='MCQ' AND qv.language='EN'
              AND qv.solution_status='DONE' AND qv.correct_option_label IS NOT NULL
              AND COALESCE(qv.status,'') != 'JUNK'
              AND qv.subtype LIKE 'ca\\_%' ESCAPE '\\'
              AND (qv.meta_json->>'relevance_year')::int * 4
                  + (qv.meta_json->>'relevance_quarter')::int >= $1
              AND NOT EXISTS (
                  SELECT 1 FROM mock_test_question mtq
                  JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
                  WHERE mtq.question_id = qv.question_id AND mt.exam_id = $2
              )
            ORDER BY (qv.meta_json->>'relevance_year')::int DESC,
                     (qv.meta_json->>'relevance_quarter')::int DESC,
                     random()
        `, [caCutoffYq, CGL_T1_EXAM_ID]);
        const available = poolRes.rows;
        let availIdx = 0;

        const report = [];
        let totalFilled = 0;

        for (const mock of mocksRes.rows) {
            const mockTestId = mock.mock_test_id;
            const stats = mock.stats_json || {};
            const placeholders = Array.isArray(stats.placeholders) ? stats.placeholders : [];
            const caPlaceholders = placeholders.filter(p =>
                typeof p.placeholder_id === 'string' && p.placeholder_id.startsWith('PLACEHOLDER_GA_CA')
            );
            if (caPlaceholders.length === 0) {
                report.push({ mock_test_id: mockTestId, ca_placeholders: 0, filled: 0 });
                continue;
            }

            const filledHere = [];
            const stillPending = [];
            for (const ph of caPlaceholders) {
                if (availIdx >= available.length) {
                    stillPending.push(ph);
                    continue;
                }
                const pick = available[availIdx++];
                filledHere.push({ ph, pick });
            }

            if (!dryRun && filledHere.length > 0) {
                await client.query('BEGIN');
                for (const { ph, pick } of filledHere) {
                    await client.query(`
                        INSERT INTO mock_test_question
                          (mock_test_id, question_id, exam_section_id, position,
                           slot_subtype, slot_difficulty, group_id, review_status, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, NULL, 'PENDING', NOW())
                    `, [
                        mockTestId,
                        pick.question_id,
                        gaTargetId,
                        ph.position,
                        'current_affairs',
                        pick.difficulty != null ? String(pick.difficulty) : null,
                    ]);
                }
                const newPlaceholders = placeholders.filter(p =>
                    !filledHere.some(f => f.ph.placeholder_id === p.placeholder_id)
                );
                const newStats = { ...stats, placeholders: newPlaceholders };
                await client.query(
                    `UPDATE mock_test SET stats_json=$1::jsonb, updated_at=NOW() WHERE mock_test_id=$2`,
                    [JSON.stringify(newStats), mockTestId]
                );
                await client.query('COMMIT');
            }
            totalFilled += filledHere.length;
            report.push({
                mock_test_id: mockTestId,
                ca_placeholders: caPlaceholders.length,
                filled: filledHere.length,
                still_pending: stillPending.length,
            });
        }

        return NextResponse.json({
            success: true,
            dry_run: dryRun,
            ca_pool_size: available.length,
            ca_pool_remaining: Math.max(0, available.length - availIdx),
            total_placeholders_filled: totalFilled,
            mocks: report,
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('current-affairs/backfill-placeholders error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
