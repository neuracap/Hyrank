import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { translateToHindi } from '@/lib/translate-helpers';
import { getSpecByExamId, getSpec } from '@/lib/mock-spec-resolver';

export const dynamic = 'force-dynamic';
// 75 questions × 5 fields × ~300ms ≈ 100 s sequential; parallelized this is
// closer to ~20 s. Keep a generous ceiling for cold DeepSeek starts.
export const maxDuration = 300;

// How many EN rows we translate concurrently. Each in-flight row briefly
// borrows ONE DB connection during persist, so the cap stays under db.js
// pool max (5) so unrelated traffic still gets a slot.
const ROW_CONCURRENCY = 4;
const TARGET_SECTIONS = ['GA', 'REASONING', 'QUANT'];

/**
 * POST /api/mock-test/[id]/translate-hindi
 *
 * For a CGL T1 or CHSL T1 mock, translates every GA/REASONING/QUANT question's
 * stem + 4 options EN → HI via DeepSeek (lib/translate-helpers). Overwrites
 * existing HI rows.
 *
 * ENGLISH section is skipped — translating English-literacy questions defeats
 * their purpose. Solution explanations are NOT translated in this pass.
 *
 * Mocks must be APPROVED or PUBLISHED. Returns a per-section summary.
 *
 * Concurrency: rows are processed in chunks of ROW_CONCURRENCY in parallel.
 * Within a row, stem + 4 options translate together under one Promise.all.
 * Each row owns its own DB connection + transaction (vs. the prior shared-
 * client design which forced serial processing).
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;

    try {
        // 1. Verify mock state + resolve which exam spec to use (CGL vs CHSL)
        const mockRes = await db.query(
            `SELECT mock_test_id, exam_id, status, stats_json
             FROM mock_test WHERE mock_test_id = $1`,
            [mockTestId]
        );
        if (mockRes.rows.length === 0) {
            return NextResponse.json({ error: 'Mock not found' }, { status: 404 });
        }
        const mock = mockRes.rows[0];
        if (!['APPROVED', 'PUBLISHED'].includes(mock.status)) {
            return NextResponse.json({
                error: `Translate is only available on APPROVED or PUBLISHED mocks. Current: ${mock.status}.`,
            }, { status: 400 });
        }

        const SPEC = getSpecByExamId(mock.exam_id) || getSpec('cgl-t1');
        const targetSectionIds = TARGET_SECTIONS.map(c => SPEC.TARGET_SECTION_IDS[c]);
        const codeBySectionId = Object.fromEntries(
            TARGET_SECTIONS.map(c => [SPEC.TARGET_SECTION_IDS[c], c])
        );

        // 2. Load every question in target sections (one row per question)
        const qRes = await db.query(`
            SELECT mtq.question_id, mtq.exam_section_id,
                   qv.version_no, qv.body_json,
                   qv.correct_option_label, qv.difficulty, qv.subtype,
                   qv.leaf_topic_id
            FROM mock_test_question mtq
            JOIN question_version qv
              ON qv.question_id = mtq.question_id
             AND qv.language = 'EN'
             AND qv.version_no = (
               SELECT MAX(version_no) FROM question_version
               WHERE question_id = mtq.question_id AND language = 'EN'
             )
            WHERE mtq.mock_test_id = $1
              AND mtq.exam_section_id = ANY($2)
            ORDER BY mtq.exam_section_id, mtq.position
        `, [mockTestId, targetSectionIds]);

        if (qRes.rows.length === 0) {
            return NextResponse.json({ error: 'No translatable questions found' }, { status: 404 });
        }

        // 3. Pre-fetch all EN options in one go
        const qids = qRes.rows.map(r => r.question_id);
        const optsRes = await db.query(`
            SELECT question_id, version_no, option_key, option_json, is_correct
            FROM question_option
            WHERE question_id = ANY($1) AND language = 'EN'
        `, [qids]);
        const optsByQ = {};
        for (const row of optsRes.rows) {
            const key = `${row.question_id}:${row.version_no}`;
            if (!optsByQ[key]) optsByQ[key] = {};
            optsByQ[key][row.option_key] = row;
        }

        // 4. Translate + upsert HI for each question, with per-row connection
        //    borrow so the chunked Promise.all below doesn't share txn state.
        const counts = { processed: 0, failed: 0, by_section: {} };
        const errors = [];

        const processRow = async (r) => {
            const sectionCode = codeBySectionId[r.exam_section_id] || '?';
            counts.by_section[sectionCode] = counts.by_section[sectionCode] || { processed: 0, failed: 0 };

            try {
                // ---- Translate text fields (NO DB connection held) ----
                const stemEn = r.body_json?.text || '';
                const enOpts = optsByQ[`${r.question_id}:${r.version_no}`] || {};

                const [stemHi, hiOptA, hiOptB, hiOptC, hiOptD] = await Promise.all([
                    translateToHindi(stemEn),
                    translateToHindi(enOpts.A?.option_json?.text || ''),
                    translateToHindi(enOpts.B?.option_json?.text || ''),
                    translateToHindi(enOpts.C?.option_json?.text || ''),
                    translateToHindi(enOpts.D?.option_json?.text || ''),
                ]);
                const hiOpts = { A: hiOptA, B: hiOptB, C: hiOptC, D: hiOptD };

                // ---- Persist (BORROW connection now, release in finally) ----
                const client = await db.connect();
                try {
                    await client.query('BEGIN');

                    // Does an HI version_no = r.version_no already exist? If yes, UPDATE; else INSERT.
                    const existing = await client.query(
                        `SELECT 1 FROM question_version
                         WHERE question_id = $1 AND version_no = $2 AND language = 'HI'`,
                        [r.question_id, r.version_no]
                    );

                    const newBody = { ...(r.body_json || {}), text: stemHi };
                    const metaPatch = JSON.stringify({
                        translated_by: user.id,
                        translated_at: new Date().toISOString(),
                        mock_test_id: mockTestId,
                        source: 'bulk_translate_hindi',
                    });

                    if (existing.rows.length > 0) {
                        await client.query(`
                            UPDATE question_version
                            SET body_json = $1::jsonb,
                                status    = 'DRAFT',
                                meta_json = COALESCE(meta_json, '{}'::jsonb) || $2::jsonb,
                                updated_at = NOW()
                            WHERE question_id = $3 AND version_no = $4 AND language = 'HI'
                        `, [JSON.stringify(newBody), metaPatch, r.question_id, r.version_no]);
                    } else {
                        await client.query(`
                            INSERT INTO question_version
                              (question_id, version_no, language, status, exam_section_id,
                               body_json, question_type, has_image, difficulty, subtype,
                               leaf_topic_id, correct_option_label, solution_status,
                               source_type, meta_json, created_at, updated_at)
                            VALUES ($1, $2, 'HI', 'DRAFT', $3,
                                    $4::jsonb, 'MCQ', false, $5, $6,
                                    $7, $8, 'PENDING',
                                    'bank', $9::jsonb, NOW(), NOW())
                        `, [
                            r.question_id, r.version_no, r.exam_section_id,
                            JSON.stringify(newBody), r.difficulty, r.subtype,
                            r.leaf_topic_id, r.correct_option_label, metaPatch,
                        ]);
                    }

                    // Options: upsert each
                    for (const k of ['A', 'B', 'C', 'D']) {
                        const isCorrect = r.correct_option_label === k;
                        const optJson = JSON.stringify({ text: hiOpts[k], format: 'mmd' });
                        const existsOpt = await client.query(
                            `SELECT 1 FROM question_option
                             WHERE question_id = $1 AND version_no = $2 AND language = 'HI' AND option_key = $3`,
                            [r.question_id, r.version_no, k]
                        );
                        if (existsOpt.rows.length > 0) {
                            await client.query(`
                                UPDATE question_option
                                SET option_json = $1::jsonb, is_correct = $2
                                WHERE question_id = $3 AND version_no = $4 AND language = 'HI' AND option_key = $5
                            `, [optJson, isCorrect, r.question_id, r.version_no, k]);
                        } else {
                            await client.query(`
                                INSERT INTO question_option
                                  (question_id, version_no, language, option_key,
                                   option_json, is_correct, created_at)
                                VALUES ($1, $2, 'HI', $3, $4::jsonb, $5, NOW())
                            `, [r.question_id, r.version_no, k, optJson, isCorrect]);
                        }
                    }

                    await client.query('COMMIT');
                    counts.processed++;
                    counts.by_section[sectionCode].processed++;
                } catch (txErr) {
                    await client.query('ROLLBACK').catch(() => {});
                    throw txErr;
                } finally {
                    client.release();
                }
            } catch (perRowErr) {
                counts.failed++;
                counts.by_section[sectionCode].failed++;
                errors.push({
                    question_id: r.question_id,
                    section: sectionCode,
                    error: perRowErr.message,
                });
                console.error(`translate-hindi qid=${r.question_id}:`, perRowErr);
            }
        };

        // Chunked parallelism: each chunk waits for the slowest member before
        // the next chunk starts. Keeps in-flight DB connections bounded.
        for (let i = 0; i < qRes.rows.length; i += ROW_CONCURRENCY) {
            const chunk = qRes.rows.slice(i, i + ROW_CONCURRENCY);
            await Promise.all(chunk.map(processRow));
        }

        // 5. Mark on mock
        const newStats = {
            ...(mock.stats_json || {}),
            hindi_translation_at: new Date().toISOString(),
            hindi_translation_by: user.id,
            hindi_translation_counts: counts,
        };
        await db.query(
            `UPDATE mock_test SET stats_json = $1::jsonb, updated_at = NOW() WHERE mock_test_id = $2`,
            [JSON.stringify(newStats), mockTestId]
        );

        return NextResponse.json({
            success: true,
            exam_key: SPEC.examKey,
            counts,
            errors_sample: errors.slice(0, 10),
        });
    } catch (e) {
        console.error('mock-test/translate-hindi error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
