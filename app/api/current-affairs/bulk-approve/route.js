import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { translate } from 'google-translate-api-x';
import { BANK_SECTION_IDS, CA_SUBTYPES } from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_LABELS = ['A', 'B', 'C', 'D'];

async function tr(text) {
    if (!text || !String(text).trim()) return '';
    const res = await translate(String(text), { to: 'hi' });
    return res.text || '';
}

/**
 * POST /api/current-affairs/bulk-approve
 *
 * One-shot: insert N CA questions DIRECTLY as APPROVED into the bank.
 * Skips the manual NEW -> edit -> approve loop.
 *
 * Body:
 *   {
 *     year: 2026, quarter: 2,         // batch defaults (per-item override allowed)
 *     source?: "PIB", source_url?: "...",
 *     items: [{
 *       id?:        "tracking-id",    // optional, stored for dedupe traceability
 *       question:   "stem text",
 *       options:    { A, B, C, D },
 *       answer:     "A|B|C|D",
 *       ca_subtype: "ca_economy|ca_polity_schemes|ca_awards_sports|ca_international|ca_science_tech|ca_misc",
 *       difficulty: 1|2|3|4,          // default 2
 *       solution?:  "explanation",    // saved in solution_json.display_sections
 *       headline?:  "...", summary?: "...", category?: "...",
 *       relevance_year?: 2026, relevance_quarter?: 2  // optional overrides
 *     }, ...]
 *   }
 *
 * For each item, in a single transaction:
 *   1. INSERT current_affairs (status='APPROVED', linked to new question_id)
 *   2. INSERT question + question_version EN + question_version HI (translated)
 *   3. INSERT 8 question_option rows (EN + HI x A-D)
 *
 * Returns per-item success/skip with reasons.
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
        return NextResponse.json({ error: 'items array required' }, { status: 400 });
    }

    const batchYear = parseInt(body.year, 10);
    const batchQuarter = parseInt(body.quarter, 10);
    if (!Number.isInteger(batchYear) || batchYear < 2000 || batchYear > 2100) {
        return NextResponse.json({ error: 'year must be a 4-digit number' }, { status: 400 });
    }
    if (!Number.isInteger(batchQuarter) || batchQuarter < 1 || batchQuarter > 4) {
        return NextResponse.json({ error: 'quarter must be 1, 2, 3, or 4' }, { status: 400 });
    }

    const sourceTag = body.source || null;
    const sourceUrl = body.source_url || null;
    const gaBankSectionId = BANK_SECTION_IDS.GA;

    const inserted = [];
    const skipped = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i] || {};
        const question = String(item.question || '').trim();
        const options = item.options || {};
        const answer = String(item.answer || '').toUpperCase();
        const caSubtype = String(item.ca_subtype || '');
        const difficulty = item.difficulty == null ? 2 : parseInt(item.difficulty, 10);
        const year = item.relevance_year == null ? batchYear : parseInt(item.relevance_year, 10);
        const quarter = item.relevance_quarter == null ? batchQuarter : parseInt(item.relevance_quarter, 10);
        const sourceId = item.id ?? null;

        // Validate
        const missing = [];
        if (!question) missing.push('question');
        for (const k of VALID_LABELS) {
            if (!options[k] || typeof options[k] !== 'string' || !options[k].trim()) {
                missing.push(`option ${k}`);
            }
        }
        if (!VALID_LABELS.includes(answer)) missing.push('answer');
        if (!CA_SUBTYPES.includes(caSubtype)) missing.push(`ca_subtype (got "${caSubtype}")`);
        if (![1, 2, 3, 4].includes(difficulty)) missing.push('difficulty (1-4)');
        if (!Number.isInteger(year) || year < 2000 || year > 2100) missing.push('relevance_year');
        if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) missing.push('relevance_quarter');
        if (missing.length > 0) {
            skipped.push({ index: i, source_id: sourceId, reason: `malformed item: ${missing.join(', ')}` });
            continue;
        }

        // Translate EN -> HI in parallel (outside transaction so failures don't burn a connection)
        let stemHi, optionsHi, solutionHi;
        try {
            const [sHi, aHi, bHi, cHi, dHi, solHi] = await Promise.all([
                tr(question),
                tr(options.A),
                tr(options.B),
                tr(options.C),
                tr(options.D),
                item.solution ? tr(item.solution) : Promise.resolve(null),
            ]);
            stemHi = sHi;
            optionsHi = { A: aHi, B: bHi, C: cHi, D: dHi };
            solutionHi = solHi;
        } catch (te) {
            console.error(`bulk-approve item ${i} translation failed:`, te);
            skipped.push({ index: i, source_id: sourceId, reason: `translation failed: ${te.message}` });
            continue;
        }

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const newQid = crypto.randomUUID();

            // 1) current_affairs row, APPROVED, linked
            const caRes = await client.query(`
                INSERT INTO current_affairs
                  (headline, summary, source, source_url, category, mcq_json,
                   status, relevance_year, relevance_quarter, difficulty, ca_subtype,
                   materialized_question_id, materialized_at, created_at)
                VALUES ($1, $2, $3, $4, $5, $6,
                        'APPROVED', $7, $8, $9, $10, $11, NOW(), NOW())
                RETURNING id
            `, [
                item.headline || question.slice(0, 200),
                item.summary || null,
                sourceTag,
                sourceUrl,
                item.category || null,
                JSON.stringify({
                    stem: question,
                    options: { A: options.A, B: options.B, C: options.C, D: options.D },
                    correct_option_label: answer,
                    source_id: sourceId,
                }),
                year,
                quarter,
                difficulty,
                caSubtype,
                newQid,
            ]);
            const caId = caRes.rows[0].id;

            const metaJson = {
                ca_id: caId,
                relevance_year: year,
                relevance_quarter: quarter,
                source: sourceTag,
                source_url: sourceUrl,
                headline: item.headline || null,
                source_id: sourceId,
                approved_by: user.id,
                approved_via: 'bulk-approve',
            };

            // Optional solution JSON
            const solutionEnJson = item.solution ? {
                answer_outcome: {
                    correct_option: answer,
                    final_answer_text: options[answer],
                    core_answer_basis: item.solution,
                },
                quality_check: { issue_flag: false, issue_note: '', issue_type: [] },
                display_sections: [
                    { key: 'conceptual_solution', content: item.solution },
                ],
            } : null;
            const solutionHiJson = item.solution ? {
                answer_outcome: {
                    correct_option: answer,
                    final_answer_text: optionsHi[answer],
                    core_answer_basis: solutionHi || '',
                },
                quality_check: { issue_flag: false, issue_note: '', issue_type: [] },
                display_sections: [
                    { key: 'conceptual_solution', content: solutionHi || '' },
                ],
            } : null;

            // 2) question + question_version EN + HI
            await client.query(
                `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
                [newQid]
            );

            await client.query(`
                INSERT INTO question_version
                  (question_id, version_no, language, status, paper_session_id, exam_section_id,
                   body_json, question_type, has_image, difficulty, subtype,
                   correct_option_label, solution_json, solution_status, source_type, meta_json,
                   created_at, updated_at)
                VALUES ($1, 1, 'EN', 'APPROVED', NULL, $2,
                        $3, 'MCQ', false, $4, $5,
                        $6, $7, 'DONE', 'bank',
                        $8, NOW(), NOW())
            `, [
                newQid,
                gaBankSectionId,
                JSON.stringify({ text: question, format: 'mmd' }),
                difficulty,
                caSubtype,
                answer,
                solutionEnJson ? JSON.stringify(solutionEnJson) : null,
                JSON.stringify(metaJson),
            ]);

            await client.query(`
                INSERT INTO question_version
                  (question_id, version_no, language, status, paper_session_id, exam_section_id,
                   body_json, question_type, has_image, difficulty, subtype,
                   correct_option_label, solution_json, solution_status, source_type, meta_json,
                   created_at, updated_at)
                VALUES ($1, 1, 'HI', 'APPROVED', NULL, $2,
                        $3, 'MCQ', false, $4, $5,
                        $6, $7, 'DONE', 'bank',
                        $8, NOW(), NOW())
            `, [
                newQid,
                gaBankSectionId,
                JSON.stringify({ text: stemHi, format: 'mmd' }),
                difficulty,
                caSubtype,
                answer,
                solutionHiJson ? JSON.stringify(solutionHiJson) : null,
                JSON.stringify(metaJson),
            ]);

            // 3) 8 question_option rows (EN + HI x A-D)
            for (const k of VALID_LABELS) {
                await client.query(`
                    INSERT INTO question_option
                      (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                    VALUES ($1, 1, 'EN', $2, $3, $4, NOW())
                `, [newQid, k, JSON.stringify({ text: options[k], format: 'mmd' }), answer === k]);
                await client.query(`
                    INSERT INTO question_option
                      (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                    VALUES ($1, 1, 'HI', $2, $3, $4, NOW())
                `, [newQid, k, JSON.stringify({ text: optionsHi[k], format: 'mmd' }), answer === k]);
            }

            await client.query('COMMIT');
            inserted.push({
                index: i,
                source_id: sourceId,
                question_id: newQid,
                ca_id: caId,
            });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            console.error(`current-affairs/bulk-approve item ${i} db error:`, e);
            const reason = e.code === '23505'
                ? `duplicate (${e.detail || e.message})`
                : `db error: ${e.message}`;
            skipped.push({ index: i, source_id: sourceId, reason });
        } finally {
            client.release();
        }
    }

    return NextResponse.json({
        success: true,
        inserted_count: inserted.length,
        skipped_count: skipped.length,
        inserted,
        skipped,
    });
}
