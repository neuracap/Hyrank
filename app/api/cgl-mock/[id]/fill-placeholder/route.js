import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { TARGET_SECTION_IDS, SECTION_CODES } from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';

const VALID_LABELS = ['A', 'B', 'C', 'D'];

/**
 * POST /api/cgl-mock/[id]/fill-placeholder
 *
 * Two modes:
 *   1. Pick existing question: { placeholder_id, question_id }
 *   2. Create new (manual current affairs): { placeholder_id, ca_payload: {
 *        stem, options: { A, B, C, D }, correct_option_label, difficulty? } }
 *
 * Inserts into mock_test_question at the placeholder's position with
 * exam_section_id mapped from the placeholder's section_code, then strips
 * that placeholder out of stats_json.placeholders.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { placeholder_id } = body;
    if (!placeholder_id) return NextResponse.json({ error: 'placeholder_id required' }, { status: 400 });

    const usesCa = !!body.ca_payload;
    if (!usesCa && !body.question_id) {
        return NextResponse.json({ error: 'Provide either question_id or ca_payload' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Load mock, find the placeholder slot.
        const mtRes = await client.query(
            `SELECT mock_test_id, stats_json FROM mock_test WHERE mock_test_id = $1 FOR UPDATE`,
            [mockTestId]
        );
        if (mtRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Mock not found' }, { status: 404 });
        }
        const stats = mtRes.rows[0].stats_json || {};
        const placeholders = Array.isArray(stats.placeholders) ? stats.placeholders : [];
        const slot = placeholders.find(p => p.placeholder_id === placeholder_id);
        if (!slot) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Placeholder not found in this mock' }, { status: 404 });
        }
        const targetSectionId = TARGET_SECTION_IDS[slot.section_code];
        if (!targetSectionId) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Unknown placeholder section' }, { status: 500 });
        }

        // Decide which question_id we'll insert.
        let questionIdToInsert = null;
        let slotSubtype = null;
        let slotDifficulty = null;

        if (usesCa) {
            // ---- Mode 2: create a new manual current-affairs question ----
            const ca = body.ca_payload || {};
            const { stem, options, correct_option_label, difficulty } = ca;
            if (!stem || !options || !correct_option_label) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'ca_payload requires stem, options, correct_option_label' }, { status: 400 });
            }
            if (!VALID_LABELS.includes(correct_option_label)) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'correct_option_label must be A, B, C, or D' }, { status: 400 });
            }
            for (const k of VALID_LABELS) {
                if (!options[k] || typeof options[k] !== 'string' || !options[k].trim()) {
                    await client.query('ROLLBACK');
                    return NextResponse.json({ error: `option ${k} is required` }, { status: 400 });
                }
            }

            const diff = Number.isInteger(difficulty) && [1, 2, 3, 4].includes(difficulty) ? difficulty : 2;
            const newQid = crypto.randomUUID();

            await client.query(`INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`, [newQid]);

            await client.query(`
                INSERT INTO question_version
                  (question_id, version_no, language, status, paper_session_id, exam_section_id,
                   body_json, question_type, has_image, difficulty, subtype,
                   correct_option_label, solution_status, source_type, meta_json,
                   created_at, updated_at)
                VALUES ($1, 1, 'EN', 'MANUALLY_CORRECTED', NULL, $2,
                        $3, 'MCQ', false, $4, 'current_affairs',
                        $5, 'DONE', 'manual',
                        $6, NOW(), NOW())
            `, [
                newQid,
                targetSectionId,
                JSON.stringify({ text: stem, format: 'mmd' }),
                diff,
                correct_option_label,
                JSON.stringify({
                    source: 'manual_ca',
                    created_by: user.id,
                    cgl_mock_test_id: mockTestId,
                    placeholder_id,
                }),
            ]);

            for (const k of VALID_LABELS) {
                await client.query(`
                    INSERT INTO question_option
                      (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                    VALUES ($1, 1, 'EN', $2, $3, $4, NOW())
                `, [
                    newQid,
                    k,
                    JSON.stringify({ text: options[k], format: 'mmd' }),
                    correct_option_label === k,
                ]);
            }

            questionIdToInsert = newQid;
            slotSubtype = 'current_affairs';
            slotDifficulty = String(diff);
        } else {
            // ---- Mode 1: insert existing question_id (e.g. PYQ visual reasoning) ----
            const qid = body.question_id;
            const qvRes = await client.query(
                `SELECT subtype, difficulty FROM question_version
                 WHERE question_id = $1 AND language = 'EN' AND version_no = (
                     SELECT MAX(version_no) FROM question_version WHERE question_id = $1 AND language = 'EN'
                 )`,
                [qid]
            );
            if (qvRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'Selected question not found' }, { status: 404 });
            }
            // Refuse if this qid is already in this mock OR in any other CGL T1 mock.
            const dupeRes = await client.query(`
                SELECT 1 FROM mock_test_question mtq
                JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
                WHERE mtq.question_id = $1
                  AND (mtq.mock_test_id = $2 OR mt.exam_id = (SELECT exam_id FROM mock_test WHERE mock_test_id = $2))
                LIMIT 1
            `, [qid, mockTestId]);
            if (dupeRes.rows.length > 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'Question already used in a CGL T1 mock — pick a different one.' }, { status: 409 });
            }
            questionIdToInsert = qid;
            slotSubtype = slot.section_code === 'REASONING' ? 'visual_reasoning' : (qvRes.rows[0].subtype || null);
            slotDifficulty = qvRes.rows[0].difficulty != null ? String(qvRes.rows[0].difficulty) : null;
        }

        // Insert mock_test_question at the placeholder's position.
        await client.query(`
            INSERT INTO mock_test_question
              (mock_test_id, question_id, exam_section_id, position,
               slot_subtype, slot_difficulty, group_id, review_status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NULL, 'PENDING', NOW())
        `, [mockTestId, questionIdToInsert, targetSectionId, slot.position, slotSubtype, slotDifficulty]);

        // Strip the placeholder from stats_json.placeholders.
        const newPlaceholders = placeholders.filter(p => p.placeholder_id !== placeholder_id);
        const newStats = { ...stats, placeholders: newPlaceholders };
        await client.query(
            `UPDATE mock_test SET stats_json = $1::jsonb, updated_at = NOW() WHERE mock_test_id = $2`,
            [JSON.stringify(newStats), mockTestId]
        );

        await client.query('COMMIT');
        return NextResponse.json({
            success: true,
            placeholder_id,
            question_id: questionIdToInsert,
            position: slot.position,
            section_code: slot.section_code,
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('cgl-mock/fill-placeholder error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
