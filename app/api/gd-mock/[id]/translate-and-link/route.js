import { NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { getSpecByExamId } from '@/lib/mock-spec-resolver';
import { translateToHindi } from '@/lib/translate-helpers';

export const dynamic = 'force-dynamic';
// 60 questions × ~6 translation calls each × ~300ms ≈ 100–180 s; pad to 5 min.
export const maxDuration = 300;

/**
 * POST /api/gd-mock/[id]/translate-and-link
 *
 * Stage 2 of the GD bilingual workflow. For each REASONING / GA / QUANT
 * question on the approved EN GD mock that lacks a Hindi sibling, mints
 * a NEW Hindi question_id with the translated stem, 4 options, and
 * solution, then links it to the EN sibling via question_links
 * (similarity_score 1.0, status MACHINE_TRANSLATED).
 *
 * The ENGLISH section is intentionally skipped — translating
 * English-literacy questions defeats their purpose.
 *
 * Idempotent: questions with ANY existing question_links row are reused
 * unchanged (including pre-existing human-authored PYQ pairs marked
 * MANUALLY_CORRECTED — which are precisely the bilingual representation
 * the user wants to preserve).
 *
 * Synthetic paper_sessions: question_links requires NON-NULL
 * paper_session_id_english/hindi, but bank-sourced EN questions often
 * have NULL paper_session_id. To satisfy the constraint AND give
 * reviewers a session pair to open in the bilingual review UI, this
 * route creates two paper_session rows per mock (one EN, one HI) on
 * first run and stamps them on mock.stats_json.translation_paper_session_id_*
 * for stable re-use across re-runs and stage 3.
 *
 * Connection lifecycle: setup queries run through db.query() (the pool
 * borrows a connection per call and returns it immediately). The per-
 * question BEGIN/COMMIT transaction borrows a fresh client INSIDE the
 * loop and releases it in finally. This means a connection is held
 * for ~100ms per question (not 3 min for the whole batch), which is
 * what keeps yoloprep's public traffic flowing while admin work runs.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: mockTestId } = await params;

    // Optional ?question_id=<id> (or body { question_id: <id> }) narrows
    // the batch to a single EN qid — used by the per-row Translate HI
    // button on the hindi-review page so freshly-swapped rows can be
    // filled without re-running the whole 60-Q batch.
    let onlyQuestionId = null;
    try {
        const { searchParams } = new URL(req.url);
        onlyQuestionId = searchParams.get('question_id');
        if (!onlyQuestionId) {
            const body = await req.clone().json().catch(() => null);
            onlyQuestionId = body?.question_id || null;
        }
    } catch { /* no body — fine */ }

    try {
        // 1. Load + verify mock (one-shot, pool-borrowed)
        const mockRes = await db.query(
            `SELECT mock_test_id, exam_id, name, status, stats_json
             FROM mock_test WHERE mock_test_id = $1`,
            [mockTestId]
        );
        if (mockRes.rows.length === 0) {
            return NextResponse.json({ error: 'Mock not found' }, { status: 404 });
        }
        const mock = mockRes.rows[0];

        const SPEC = getSpecByExamId(mock.exam_id);
        if (!SPEC || SPEC.examKey !== 'gd') {
            return NextResponse.json(
                { error: 'This route is for GD mocks only' },
                { status: 400 }
            );
        }
        if (!['APPROVED', 'PUBLISHED'].includes(mock.status)) {
            return NextResponse.json(
                { error: `Translate-and-link requires APPROVED or PUBLISHED. Current: ${mock.status}.` },
                { status: 400 }
            );
        }

        // 1b. Synthetic paper_session pair (one EN, one HI) — created on first
        //     run, reused thereafter. Each INSERT pool-borrows a connection.
        let enSynthSessionId = mock.stats_json?.translation_paper_session_id_en;
        let hiSynthSessionId = mock.stats_json?.translation_paper_session_id_hi;

        if (!enSynthSessionId || !hiSynthSessionId) {
            const baseLabel = mock.name || `GD Mock ${mockTestId.slice(0, 8)}`;
            const enRes = await db.query(`
                INSERT INTO paper_session
                  (paper_session_id, exam_id, language, session_label,
                   status, ai_processed, meta_json, created_at)
                VALUES (gen_random_uuid(), $1, 'EN', $2,
                        'MANUALLY_CORRECTED', true, $3::jsonb, NOW())
                RETURNING paper_session_id
            `, [
                mock.exam_id,
                `${baseLabel} — translation source (EN)`,
                JSON.stringify({ source: 'gd_mock_translate', mock_test_id: mockTestId, side: 'EN' }),
            ]);
            enSynthSessionId = enRes.rows[0].paper_session_id;

            const hiRes = await db.query(`
                INSERT INTO paper_session
                  (paper_session_id, exam_id, language, session_label,
                   status, ai_processed, meta_json, created_at)
                VALUES (gen_random_uuid(), $1, 'HI', $2,
                        'MANUALLY_CORRECTED', true, $3::jsonb, NOW())
                RETURNING paper_session_id
            `, [
                mock.exam_id,
                `${baseLabel} — translations (HI)`,
                JSON.stringify({ source: 'gd_mock_translate', mock_test_id: mockTestId, side: 'HI' }),
            ]);
            hiSynthSessionId = hiRes.rows[0].paper_session_id;
        }

        // 2. Sections in scope: REASONING / GA / QUANT (skip ENGLISH and HINDI)
        const inScopeSectionIds = ['REASONING', 'GA', 'QUANT']
            .map(c => SPEC.TARGET_SECTION_IDS[c]);

        // 3. Pull every EN mtq row for those sections + its EN qv + its EN options.
        //    If a single question_id was requested, narrow the batch to that row.
        const qParams = [mockTestId, inScopeSectionIds];
        let extraFilter = '';
        if (onlyQuestionId) {
            qParams.push(onlyQuestionId);
            extraFilter = ` AND mtq.question_id = $${qParams.length}`;
        }
        const qRes = await db.query(`
            SELECT
                mtq.question_id        AS en_qid,
                mtq.exam_section_id    AS gd_section_id,
                mtq.position,
                qv.version_no          AS en_version_no,
                qv.body_json           AS en_body,
                qv.solution_json       AS en_solution,
                qv.subtype, qv.difficulty, qv.leaf_topic_id,
                qv.correct_option_label,
                qv.question_type,
                qv.has_image,
                qv.paper_session_id    AS en_paper_session_id
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
              ${extraFilter}
            ORDER BY mtq.exam_section_id, mtq.position
        `, qParams);

        if (qRes.rows.length === 0) {
            return NextResponse.json(
                { error: 'No translatable questions found (REASONING/GA/QUANT)' },
                { status: 404 }
            );
        }

        // Pre-fetch all EN options in one go
        const enQids = qRes.rows.map(r => r.en_qid);
        const optsRes = await db.query(`
            SELECT question_id, version_no, option_key, option_json, is_correct
            FROM question_option
            WHERE question_id = ANY($1) AND language = 'EN'
        `, [enQids]);
        const optsByQ = {};
        for (const row of optsRes.rows) {
            const key = `${row.question_id}:${row.version_no}`;
            if (!optsByQ[key]) optsByQ[key] = {};
            optsByQ[key][row.option_key] = row;
        }

        // Pre-fetch any existing question_links so we can short-circuit:
        //   - A pre-existing human pair (PYQ) → keep it untouched.
        //   - A prior machine translation from us → skip (idempotent).
        // We don't filter by status: ANY link means "this EN qid already
        // has its Hindi sibling somewhere; do not mint another."
        const existingLinksRes = await db.query(`
            SELECT english_question_id, english_version_no, hindi_question_id, status
            FROM question_links
            WHERE english_question_id = ANY($1)
        `, [enQids]);
        const linkedByEn = {};
        for (const row of existingLinksRes.rows) {
            const key = row.english_question_id;
            if (!linkedByEn[key]) linkedByEn[key] = row;
        }

        // 4. Translate + insert HI rows + link, per question, each in its own
        //    fresh-borrow client + transaction. The slow translateToHindi
        //    calls run BEFORE the borrow so we never hold a connection while
        //    waiting on google-translate-api-x.
        const counts = { processed: 0, reused: 0, failed: 0, by_section: {} };
        const errors = [];

        const codeByGdSection = Object.fromEntries(
            ['REASONING', 'GA', 'QUANT'].map(c => [SPEC.TARGET_SECTION_IDS[c], c])
        );

        for (const r of qRes.rows) {
            const sectionCode = codeByGdSection[r.gd_section_id] || '?';
            counts.by_section[sectionCode] = counts.by_section[sectionCode]
                || { processed: 0, reused: 0, failed: 0 };

            if (linkedByEn[r.en_qid]) {
                counts.reused++;
                counts.by_section[sectionCode].reused++;
                continue;
            }

            try {
                // ---- Translate text fields (NO DB connection held) ----
                const stemEn = r.en_body?.text || '';
                const stemHi = await translateToHindi(stemEn);

                const enOpts = optsByQ[`${r.en_qid}:${r.en_version_no}`] || {};
                const hiOpts = {};
                for (const k of ['A', 'B', 'C', 'D']) {
                    const enText = enOpts[k]?.option_json?.text || '';
                    hiOpts[k] = await translateToHindi(enText);
                }

                // Solution: shape-tolerant. solution_json may arrive as a JSON
                // string, an object with display_sections, an object with a flat
                // solution_text field, or null. Translate whichever student-facing
                // text fields are present; preserve everything else.
                let enSol = r.en_solution;
                if (typeof enSol === 'string') {
                    try { enSol = JSON.parse(enSol); } catch { enSol = null; }
                }
                if (!enSol || typeof enSol !== 'object' || Array.isArray(enSol)) enSol = {};

                const enSections = Array.isArray(enSol.display_sections) ? enSol.display_sections : [];
                const hiSections = [];
                for (const sec of enSections) {
                    const content = sec?.content || '';
                    hiSections.push({
                        ...sec,
                        content: content ? await translateToHindi(content) : '',
                    });
                }
                const enOutcome = (enSol.answer_outcome && typeof enSol.answer_outcome === 'object')
                    ? enSol.answer_outcome : {};
                const hiOutcome = {
                    ...enOutcome,
                    core_answer_basis: enOutcome.core_answer_basis
                        ? await translateToHindi(enOutcome.core_answer_basis) : (enOutcome.core_answer_basis || ''),
                    final_answer_text: enOutcome.final_answer_text
                        ? await translateToHindi(enOutcome.final_answer_text) : (enOutcome.final_answer_text || ''),
                };
                const hiSolution = {
                    ...enSol,
                    answer_outcome: hiOutcome,
                    display_sections: hiSections,
                };
                if (enSol.solution_text) {
                    hiSolution.solution_text = await translateToHindi(enSol.solution_text);
                }

                // ---- Persist (BORROW connection now, release in finally) ----
                const hiQid = crypto.randomUUID();
                const hiMeta = {
                    source: 'gd_mock_translate',
                    original_question_id: r.en_qid,
                    original_version_no: r.en_version_no,
                    mock_test_id: mockTestId,
                    translated_by: user.id,
                    translated_at: new Date().toISOString(),
                };
                const linkEnSessionId = r.en_paper_session_id || enSynthSessionId;

                const client = await db.connect();
                try {
                    await client.query('BEGIN');

                    await client.query(
                        `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
                        [hiQid]
                    );

                    await client.query(`
                        INSERT INTO question_version
                          (question_id, version_no, language, status, exam_section_id,
                           paper_session_id,
                           body_json, question_type, has_image, difficulty, subtype,
                           leaf_topic_id, correct_option_label, solution_status,
                           solution_json, source_type, meta_json,
                           created_at, updated_at)
                        VALUES ($1, 1, 'HI', 'DRAFT', $2,
                                $3,
                                $4::jsonb, $5, $6, $7, $8,
                                $9, $10, 'PENDING',
                                $11::jsonb, 'bank', $12::jsonb,
                                NOW(), NOW())
                    `, [
                        hiQid, r.gd_section_id, hiSynthSessionId,
                        JSON.stringify({ text: stemHi, format: 'mmd' }),
                        r.question_type || 'MCQ', r.has_image || false,
                        r.difficulty, r.subtype,
                        r.leaf_topic_id, r.correct_option_label,
                        JSON.stringify(hiSolution),
                        JSON.stringify(hiMeta),
                    ]);

                    for (const k of ['A', 'B', 'C', 'D']) {
                        await client.query(`
                            INSERT INTO question_option
                              (question_id, version_no, language, option_key,
                               option_json, is_correct, created_at)
                            VALUES ($1, 1, 'HI', $2, $3::jsonb, $4, NOW())
                        `, [
                            hiQid, k,
                            JSON.stringify({ text: hiOpts[k], format: 'mmd' }),
                            r.correct_option_label === k,
                        ]);
                    }

                    await client.query(`
                        INSERT INTO question_links
                          (english_question_id, english_version_no, english_language,
                           hindi_question_id, hindi_version_no, hindi_language,
                           paper_session_id_english, paper_session_id_hindi,
                           similarity_score, updated_score, status, created_at)
                        VALUES ($1, $2, 'EN',
                                $3, 1, 'HI',
                                $4, $5,
                                1.0, 1.0, 'MACHINE_TRANSLATED', NOW())
                    `, [r.en_qid, r.en_version_no, hiQid, linkEnSessionId, hiSynthSessionId]);

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
                    en_qid: r.en_qid,
                    section: sectionCode,
                    error: perRowErr.message,
                });
                console.error(`gd-mock translate-and-link en_qid=${r.en_qid}:`, perRowErr);
            }
        }

        // 5. Stamp the EN mock so create-hindi-pair knows translation is done.
        //    For single-question runs we don't overwrite the batch timestamp /
        //    counts (would clobber the actually-meaningful full-batch stats)
        //    — we just refresh the synthetic session ids (which usually already
        //    exist on a single-question run, so this is a no-op patch).
        const newStats = onlyQuestionId
            ? {
                ...(mock.stats_json || {}),
                translation_paper_session_id_en: enSynthSessionId,
                translation_paper_session_id_hi: hiSynthSessionId,
            }
            : {
                ...(mock.stats_json || {}),
                hindi_translation_at: new Date().toISOString(),
                hindi_translation_by: user.id,
                hindi_translation_counts: counts,
                translation_paper_session_id_en: enSynthSessionId,
                translation_paper_session_id_hi: hiSynthSessionId,
            };
        await db.query(
            `UPDATE mock_test SET stats_json = $1::jsonb, updated_at = NOW()
             WHERE mock_test_id = $2`,
            [JSON.stringify(newStats), mockTestId]
        );

        return NextResponse.json({
            success: true,
            counts,
            translation_paper_session_id_en: enSynthSessionId,
            translation_paper_session_id_hi: hiSynthSessionId,
            bilingual_review_url: `/bilingual/${enSynthSessionId}`,
            errors_sample: errors.slice(0, 10),
        });
    } catch (e) {
        console.error('gd-mock/translate-and-link error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
