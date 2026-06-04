import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { translate } from 'google-translate-api-x';
import { BANK_SECTION_IDS, CA_SUBTYPES } from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_LABELS = ['A', 'B', 'C', 'D'];

async function translateToHindi(text) {
    if (!text || !text.trim()) return '';
    const res = await translate(text, { to: 'hi' });
    return res.text || '';
}

/**
 * POST /api/current-affairs/[id]/approve
 *
 * Materializes a NEW current_affairs row into the question bank:
 *   - creates one question row + two question_version rows (EN/HI) + 8 question_option rows
 *   - sets source_type='bank', subtype=<ca_subtype>, exam_section_id=BANK_SECTION_IDS.GA
 *   - records relevance_year/quarter + source pointer in meta_json
 *   - flips current_affairs.status='APPROVED', links materialized_question_id
 *
 * Requires the CA row to have ca_subtype, relevance_year, relevance_quarter,
 * difficulty, and a valid mcq_json with stem + 4 options + correct label.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;

    const client = await db.connect();
    try {
        const curRes = await client.query(
            `SELECT id, status, mcq_json, ca_subtype, relevance_year, relevance_quarter,
                    difficulty, source, source_url, headline
             FROM current_affairs WHERE id = $1`,
            [id]
        );
        if (curRes.rows.length === 0) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const ca = curRes.rows[0];
        if (ca.status !== 'NEW') {
            return NextResponse.json({ error: `Cannot approve a ${ca.status} CA` }, { status: 409 });
        }

        // Validation
        const mcq = ca.mcq_json || {};
        const stem = (mcq.stem || '').trim();
        const options = mcq.options || {};
        const correct = mcq.correct_option_label;
        const missing = [];
        if (!stem) missing.push('stem');
        for (const k of VALID_LABELS) {
            if (!options[k] || typeof options[k] !== 'string' || !options[k].trim()) missing.push(`option ${k}`);
        }
        if (!VALID_LABELS.includes(correct)) missing.push('correct_option_label');
        if (!ca.ca_subtype || !CA_SUBTYPES.includes(ca.ca_subtype)) missing.push('ca_subtype');
        if (!ca.relevance_year) missing.push('relevance_year');
        if (!ca.relevance_quarter) missing.push('relevance_quarter');
        if (!ca.difficulty || ![1, 2, 3, 4].includes(ca.difficulty)) missing.push('difficulty');
        if (missing.length > 0) {
            return NextResponse.json({
                error: `Cannot approve — missing or invalid: ${missing.join(', ')}`,
            }, { status: 400 });
        }

        // Translate EN → HI before opening the transaction (so failures don't waste a connection slot).
        let stemHi, optionsHi;
        try {
            stemHi = await translateToHindi(stem);
            optionsHi = {};
            for (const k of VALID_LABELS) {
                optionsHi[k] = await translateToHindi(options[k]);
            }
        } catch (te) {
            console.error('CA translation failed:', te);
            return NextResponse.json({
                error: `Translation failed: ${te.message}. Reviewer can retry.`,
            }, { status: 502 });
        }

        await client.query('BEGIN');

        // Belt-and-braces: re-check NEW status under lock to prevent racing.
        const recheck = await client.query(
            `SELECT status FROM current_affairs WHERE id = $1 FOR UPDATE`,
            [id]
        );
        if (recheck.rows[0]?.status !== 'NEW') {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'CA is no longer NEW' }, { status: 409 });
        }

        const newQid = crypto.randomUUID();
        const gaBankSectionId = BANK_SECTION_IDS.GA;
        const metaJson = {
            ca_id: id,
            relevance_year: ca.relevance_year,
            relevance_quarter: ca.relevance_quarter,
            source: ca.source || null,
            source_url: ca.source_url || null,
            headline: ca.headline || null,
            approved_by: user.id,
        };

        await client.query(
            `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
            [newQid]
        );

        // EN version
        await client.query(`
            INSERT INTO question_version
              (question_id, version_no, language, status, paper_session_id, exam_section_id,
               body_json, question_type, has_image, difficulty, subtype,
               correct_option_label, solution_status, source_type, meta_json,
               created_at, updated_at)
            VALUES ($1, 1, 'EN', 'APPROVED', NULL, $2,
                    $3, 'MCQ', false, $4, $5,
                    $6, 'DONE', 'bank',
                    $7, NOW(), NOW())
        `, [
            newQid,
            gaBankSectionId,
            JSON.stringify({ text: stem, format: 'mmd' }),
            ca.difficulty,
            ca.ca_subtype,
            correct,
            JSON.stringify(metaJson),
        ]);

        // HI version (same subtype/difficulty/correct; translated body + options)
        await client.query(`
            INSERT INTO question_version
              (question_id, version_no, language, status, paper_session_id, exam_section_id,
               body_json, question_type, has_image, difficulty, subtype,
               correct_option_label, solution_status, source_type, meta_json,
               created_at, updated_at)
            VALUES ($1, 1, 'HI', 'APPROVED', NULL, $2,
                    $3, 'MCQ', false, $4, $5,
                    $6, 'DONE', 'bank',
                    $7, NOW(), NOW())
        `, [
            newQid,
            gaBankSectionId,
            JSON.stringify({ text: stemHi, format: 'mmd' }),
            ca.difficulty,
            ca.ca_subtype,
            correct,
            JSON.stringify(metaJson),
        ]);

        // Options: 4 per language
        for (const k of VALID_LABELS) {
            await client.query(`
                INSERT INTO question_option
                  (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                VALUES ($1, 1, 'EN', $2, $3, $4, NOW())
            `, [newQid, k, JSON.stringify({ text: options[k], format: 'mmd' }), correct === k]);
            await client.query(`
                INSERT INTO question_option
                  (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                VALUES ($1, 1, 'HI', $2, $3, $4, NOW())
            `, [newQid, k, JSON.stringify({ text: optionsHi[k], format: 'mmd' }), correct === k]);
        }

        await client.query(`
            UPDATE current_affairs
            SET status='APPROVED',
                materialized_question_id=$1,
                materialized_at=NOW()
            WHERE id=$2
        `, [newQid, id]);

        await client.query('COMMIT');
        return NextResponse.json({
            success: true,
            question_id: newQid,
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('current-affairs/approve error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
