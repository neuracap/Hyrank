import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { translate } from 'google-translate-api-x';
import { BANK_SECTION_IDS } from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_LABELS = ['A', 'B', 'C', 'D'];
const DEFAULT_SUBTYPE = 'comprehension_rc';

async function tr(text) {
    if (!text || !String(text).trim()) return '';
    const res = await translate(String(text), { to: 'hi' });
    return res.text || '';
}

/**
 * Normalize answer field to "A" | "B" | "C" | "D" | null.
 *   accepts: "Option d", "option D", "d", "D", "A.", "(B)" -> normalized.
 */
function normalizeAnswer(raw) {
    if (raw == null) return null;
    const m = String(raw).match(/[A-Da-d]/);
    return m ? m[0].toUpperCase() : null;
}

/**
 * Normalize options to { A, B, C, D }.
 *   accepts:
 *     - { A: "...", B: "...", C: "...", D: "..." }
 *     - [{ label: "a", text: "..." }, ...]
 *     - ["...","...","...","..."]   (order = A,B,C,D)
 */
function normalizeOptions(raw) {
    if (!raw) return null;
    const out = {};
    if (Array.isArray(raw)) {
        // array form
        for (let i = 0; i < raw.length; i++) {
            const item = raw[i];
            if (item && typeof item === 'object' && 'label' in item && 'text' in item) {
                const label = String(item.label).toUpperCase().replace(/[^A-D]/g, '');
                if (VALID_LABELS.includes(label)) out[label] = String(item.text || '').trim();
            } else if (typeof item === 'string') {
                const label = VALID_LABELS[i];
                if (label) out[label] = item.trim();
            }
        }
    } else if (typeof raw === 'object') {
        for (const k of Object.keys(raw)) {
            const upper = String(k).toUpperCase();
            if (VALID_LABELS.includes(upper)) out[upper] = String(raw[k] || '').trim();
        }
    }
    for (const k of VALID_LABELS) if (!out[k]) return null;
    return out;
}

/**
 * Normalize difficulty.
 *
 * Word labels (what authors actually type in RC files):
 *   easy   -> 2
 *   medium -> 3
 *   hard   -> 4
 *
 * Difficulty 1 is reserved for "very easy" newbie-level questions
 * (e.g. GD Constable / practice for beginners) — RC questions should
 * never land at 1 because real RC is never that trivial. To land at 1
 * the author must pass the explicit integer 1 or string "1".
 *
 * Explicit numeric input (1|2|3|4 or "1"|"2"|"3"|"4") is passed through
 * unchanged so authors can override.
 */
function normalizeDifficulty(raw) {
    if (raw == null) return 3; // default = medium under the new convention
    if (typeof raw === 'number') {
        const n = Math.round(raw);
        return [1, 2, 3, 4].includes(n) ? n : null;
    }
    const s = String(raw).trim().toLowerCase();
    const map = {
        // explicit numeric strings pass through
        '1': 1, '2': 2, '3': 3, '4': 4,
        // word labels — RC convention (easy/medium/hard -> 2/3/4)
        'easy': 2, 'e': 2,
        'medium': 3, 'med': 3, 'm': 3,
        'hard': 4, 'h': 4,
        'very_hard': 4, 'very hard': 4, 'vh': 4,
    };
    return map[s] ?? null;
}

/**
 * POST /api/rc/bulk-approve
 *
 * Insert N RC passages (each with their member questions) directly as APPROVED.
 * Each passage creates one question_group (group_type='RC') in a single transaction:
 *   1) passage row (question_type='PASSAGE', group_id=NULL, subtype=NULL)
 *   2) member question rows (question_type='MCQ', group_id=<new>, group_order=1..N,
 *      subtype='comprehension_rc', solution_status='DONE', source_type='bank', APPROVED)
 *   3) 8 question_option rows per member (EN + HI x A-D)
 *
 * Body shape (mirrors the rc_question_bank_*.json format):
 *   {
 *     "subtype": "comprehension_rc",   // optional, default
 *     "skip_hindi": false,             // optional, default false (auto-translate EN->HI)
 *     "source_tag": "Face2Face CAT",   // optional, batch metadata into meta_json
 *     "exam_section_code": "ENGLISH",  // optional, defaults to ENGLISH bank
 *     "passages": [{
 *       "passage_id": "P21", "title": "...", "part": "...", "chapter": "...",
 *       "passage_text": "...",
 *       "questions": [{
 *         "qid": "P21Q85",
 *         "stem": "...",
 *         "options": [{"label":"a","text":"..."}, ...]  // OR { A, B, C, D }
 *         "answer": "Option d",      // OR "d", "D"
 *         "difficulty": "medium",    // OR 1|2|3|4 or "easy"/"medium"/"hard"
 *         "solution": "...",         // optional
 *         "source": "book"           // optional, into meta
 *       }]
 *     }]
 *   }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const passages = Array.isArray(body.passages) ? body.passages : [];
    if (passages.length === 0) {
        return NextResponse.json({ error: 'passages array required' }, { status: 400 });
    }

    const subtype = (body.subtype || DEFAULT_SUBTYPE).toString().trim();
    const skipHindi = !!body.skip_hindi;
    const sourceTag = body.source_tag || null;
    const examSectionCode = (body.exam_section_code || 'ENGLISH').toString().toUpperCase();
    const examSectionId = BANK_SECTION_IDS[examSectionCode];
    if (!examSectionId) {
        return NextResponse.json({
            error: `Unknown exam_section_code "${examSectionCode}" (valid: ${Object.keys(BANK_SECTION_IDS).join(', ')})`,
        }, { status: 400 });
    }

    const inserted = [];
    const skipped = [];

    for (let pIdx = 0; pIdx < passages.length; pIdx++) {
        const p = passages[pIdx] || {};
        const passageText = String(p.passage_text || '').trim();
        const passageId = p.passage_id || null;
        const questions = Array.isArray(p.questions) ? p.questions : [];

        // Validate passage; bad-question rows are SKIPPED individually,
        // but the passage still proceeds if at least one valid question remains.
        const passageErrs = [];
        if (!passageText) passageErrs.push('passage_text missing');
        if (questions.length === 0) passageErrs.push('questions array empty');

        // Normalize each question; collect drops with reasons.
        const normalized = [];
        const droppedQuestions = [];
        for (let qIdx = 0; qIdx < questions.length; qIdx++) {
            const q = questions[qIdx] || {};
            const stem = String(q.stem || '').trim();
            const opts = normalizeOptions(q.options);
            const ans = normalizeAnswer(q.answer);
            const diff = normalizeDifficulty(q.difficulty);
            const localErrs = [];
            if (!stem) localErrs.push('stem missing');
            if (!opts) localErrs.push('options invalid (need A-D)');
            if (!ans) localErrs.push('answer invalid');
            if (!diff) localErrs.push('difficulty invalid');
            if (localErrs.length > 0) {
                droppedQuestions.push({
                    q_index: qIdx,
                    qid: q.qid || null,
                    reasons: localErrs,
                });
                continue;
            }
            normalized.push({
                qid: q.qid || null,
                stem,
                options: opts,
                answer: ans,
                difficulty: diff,
                solution: q.solution ? String(q.solution).trim() : null,
                source: q.source || null,
            });
        }

        // Skip whole passage only if passage-level fail OR no valid questions left
        if (passageErrs.length > 0 || normalized.length === 0) {
            const reason = passageErrs.length > 0
                ? `passage: ${passageErrs.join('; ')}`
                : 'no valid questions left (all dropped during validation)';
            skipped.push({
                index: pIdx,
                passage_id: passageId,
                reason,
                dropped_questions: droppedQuestions,
            });
            continue;
        }

        // Translate everything for this passage in one Promise.all (skip if skip_hindi)
        let passageHi = '';
        const qHi = normalized.map(() => ({ stem: '', options: { A: '', B: '', C: '', D: '' }, solution: '' }));
        if (!skipHindi) {
            try {
                const trJobs = [tr(passageText)];
                for (const q of normalized) {
                    trJobs.push(tr(q.stem));
                    for (const k of VALID_LABELS) trJobs.push(tr(q.options[k]));
                    trJobs.push(q.solution ? tr(q.solution) : Promise.resolve(''));
                }
                const results = await Promise.all(trJobs);
                passageHi = results[0];
                let cursor = 1;
                for (let qi = 0; qi < normalized.length; qi++) {
                    qHi[qi].stem = results[cursor++];
                    for (const k of VALID_LABELS) qHi[qi].options[k] = results[cursor++];
                    qHi[qi].solution = results[cursor++];
                }
            } catch (te) {
                console.error(`rc/bulk-approve passage ${pIdx} translation failed:`, te);
                skipped.push({ index: pIdx, passage_id: passageId, reason: `translation failed: ${te.message}` });
                continue;
            }
        }

        // DB writes — one transaction per passage
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const newGroupId = crypto.randomUUID();
            const newPassageQid = crypto.randomUUID();

            // 1) question_group (passage_question_id set after passage row exists)
            await client.query(`
                INSERT INTO question_group
                  (group_id, group_type, passage_question_id, exam_section_id, created_at)
                VALUES ($1, 'RC', NULL, $2, NOW())
            `, [newGroupId, examSectionId]);

            // 2) passage question + 2 versions (EN + HI)
            await client.query(
                `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
                [newPassageQid]
            );

            const passageMeta = {
                rc_group_id: newGroupId,
                passage_id: passageId,
                title: p.title || null,
                part: p.part || null,
                chapter: p.chapter || null,
                source_tag: sourceTag,
                approved_by: user.id,
                approved_via: 'rc-bulk-approve',
            };

            await client.query(`
                INSERT INTO question_version
                  (question_id, version_no, language, status, paper_session_id, exam_section_id,
                   body_json, question_type, has_image, difficulty, subtype,
                   correct_option_label, solution_status, source_type, meta_json,
                   group_id, group_order, created_at, updated_at)
                VALUES ($1, 1, 'EN', 'APPROVED', NULL, $2,
                        $3, 'PASSAGE', false, NULL, NULL,
                        NULL, 'pending', 'bank', $4,
                        NULL, NULL, NOW(), NOW())
            `, [
                newPassageQid,
                examSectionId,
                JSON.stringify({ text: passageText, format: 'mmd' }),
                JSON.stringify(passageMeta),
            ]);

            await client.query(`
                INSERT INTO question_version
                  (question_id, version_no, language, status, paper_session_id, exam_section_id,
                   body_json, question_type, has_image, difficulty, subtype,
                   correct_option_label, solution_status, source_type, meta_json,
                   group_id, group_order, created_at, updated_at)
                VALUES ($1, 1, 'HI', 'APPROVED', NULL, $2,
                        $3, 'PASSAGE', false, NULL, NULL,
                        NULL, 'pending', 'bank', $4,
                        NULL, NULL, NOW(), NOW())
            `, [
                newPassageQid,
                examSectionId,
                JSON.stringify({ text: passageHi, format: 'mmd' }),
                JSON.stringify(passageMeta),
            ]);

            // Link the group to the passage
            await client.query(
                `UPDATE question_group SET passage_question_id = $1 WHERE group_id = $2`,
                [newPassageQid, newGroupId]
            );

            // 3) member questions
            const memberRecords = [];
            for (let qi = 0; qi < normalized.length; qi++) {
                const q = normalized[qi];
                const hi = qHi[qi];
                const newQid = crypto.randomUUID();
                const groupOrder = qi + 1;

                const memberMeta = {
                    rc_group_id: newGroupId,
                    passage_id: passageId,
                    passage_question_id: newPassageQid,
                    source_qid: q.qid,
                    source_label: q.source,
                    source_tag: sourceTag,
                    approved_by: user.id,
                    approved_via: 'rc-bulk-approve',
                };

                const solutionEnJson = q.solution ? {
                    answer_outcome: {
                        correct_option: q.answer,
                        final_answer_text: q.options[q.answer],
                        core_answer_basis: q.solution,
                    },
                    quality_check: { issue_flag: false, issue_note: '', issue_type: [] },
                    display_sections: [
                        { key: 'conceptual_solution', content: q.solution },
                    ],
                } : null;
                const solutionHiJson = q.solution ? {
                    answer_outcome: {
                        correct_option: q.answer,
                        final_answer_text: hi.options[q.answer],
                        core_answer_basis: hi.solution || '',
                    },
                    quality_check: { issue_flag: false, issue_note: '', issue_type: [] },
                    display_sections: [
                        { key: 'conceptual_solution', content: hi.solution || '' },
                    ],
                } : null;

                await client.query(
                    `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
                    [newQid]
                );

                // EN
                await client.query(`
                    INSERT INTO question_version
                      (question_id, version_no, language, status, paper_session_id, exam_section_id,
                       body_json, question_type, has_image, difficulty, subtype,
                       correct_option_label, solution_json, solution_status, source_type, meta_json,
                       group_id, group_order, created_at, updated_at)
                    VALUES ($1, 1, 'EN', 'APPROVED', NULL, $2,
                            $3, 'MCQ', false, $4, $5,
                            $6, $7, 'DONE', 'bank',
                            $8, $9, $10, NOW(), NOW())
                `, [
                    newQid, examSectionId,
                    JSON.stringify({ text: q.stem, format: 'mmd' }),
                    q.difficulty, subtype, q.answer,
                    solutionEnJson ? JSON.stringify(solutionEnJson) : null,
                    JSON.stringify(memberMeta),
                    newGroupId, groupOrder,
                ]);

                // HI
                await client.query(`
                    INSERT INTO question_version
                      (question_id, version_no, language, status, paper_session_id, exam_section_id,
                       body_json, question_type, has_image, difficulty, subtype,
                       correct_option_label, solution_json, solution_status, source_type, meta_json,
                       group_id, group_order, created_at, updated_at)
                    VALUES ($1, 1, 'HI', 'APPROVED', NULL, $2,
                            $3, 'MCQ', false, $4, $5,
                            $6, $7, 'DONE', 'bank',
                            $8, $9, $10, NOW(), NOW())
                `, [
                    newQid, examSectionId,
                    JSON.stringify({ text: hi.stem, format: 'mmd' }),
                    q.difficulty, subtype, q.answer,
                    solutionHiJson ? JSON.stringify(solutionHiJson) : null,
                    JSON.stringify(memberMeta),
                    newGroupId, groupOrder,
                ]);

                // 8 options
                for (const k of VALID_LABELS) {
                    await client.query(`
                        INSERT INTO question_option
                          (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                        VALUES ($1, 1, 'EN', $2, $3, $4, NOW())
                    `, [newQid, k, JSON.stringify({ text: q.options[k], format: 'mmd' }), q.answer === k]);
                    await client.query(`
                        INSERT INTO question_option
                          (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                        VALUES ($1, 1, 'HI', $2, $3, $4, NOW())
                    `, [newQid, k, JSON.stringify({ text: hi.options[k], format: 'mmd' }), q.answer === k]);
                }

                memberRecords.push({
                    group_order: groupOrder,
                    question_id: newQid,
                    source_qid: q.qid,
                });
            }

            await client.query('COMMIT');
            inserted.push({
                index: pIdx,
                passage_id: passageId,
                group_id: newGroupId,
                passage_question_id: newPassageQid,
                member_count: memberRecords.length,
                members: memberRecords,
                dropped_questions: droppedQuestions,
            });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            console.error(`rc/bulk-approve passage ${pIdx} db error:`, e);
            const reason = e.code === '23505'
                ? `duplicate (${e.detail || e.message})`
                : `db error: ${e.message}`;
            skipped.push({ index: pIdx, passage_id: passageId, reason });
        } finally {
            client.release();
        }
    }

    const droppedQuestionTotal =
        inserted.reduce((s, p) => s + (p.dropped_questions?.length || 0), 0) +
        skipped.reduce((s, p) => s + (p.dropped_questions?.length || 0), 0);

    return NextResponse.json({
        success: true,
        inserted_count: inserted.length,
        skipped_count: skipped.length,
        member_count_total: inserted.reduce((s, p) => s + p.member_count, 0),
        dropped_question_total: droppedQuestionTotal,
        inserted,
        skipped,
    });
}
