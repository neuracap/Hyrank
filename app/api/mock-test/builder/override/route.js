import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/mock-test/builder/override
 * Save edits to a copied mock-test question.
 *
 * Rules:
 *   - difficulty / solution / options / correct_option changed → UPDATE in place
 *   - question_text changed → create a brand-new question_id (new question_version
 *     + question_option rows), re-point mock_test_question, delete old copy.
 *     Returns { success: true, new_question_id } so the frontend can swap the ID.
 *
 * Body: {
 *   question_id,      — the COPIED question_id (not the source)
 *   question_text?,
 *   options?,         — [{ key, text }]
 *   correct_option?,
 *   solution_text?,
 *   difficulty?,      — 1 | 2 | 3
 *   mock_test_id?,    — needed to re-point mock_test_question on stem change
 * }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { question_id, question_text, options, correct_option, solution_text, difficulty, mock_test_id } = body;
    if (!question_id) {
        return NextResponse.json({ error: 'question_id is required' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // ── Decide whether the stem changed ──────────────────────────────────
        let stemChanged = false;
        let currentRow  = null;

        if (question_text !== undefined) {
            const cur = await client.query(
                `SELECT body_json, solution_json, question_type, subtype, difficulty AS cur_diff,
                        has_image, correct_option_label, source_question_no, meta_json, exam_section_id
                 FROM question_version
                 WHERE question_id = $1 AND language = 'EN'
                 LIMIT 1`,
                [question_id]
            );
            if (cur.rows.length === 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'Question not found' }, { status: 404 });
            }
            currentRow = cur.rows[0];
            const storedText = currentRow.body_json?.text ?? '';
            stemChanged = question_text.trim() !== storedText.trim();
        }

        // ── STEM CHANGED: create a new question_id ────────────────────────────
        if (stemChanged) {
            if (!mock_test_id) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'mock_test_id is required when question text changes' }, { status: 400 });
            }

            const newId = (await client.query('SELECT gen_random_uuid() AS id')).rows[0].id;

            // Load current options to carry forward
            const optsRes = await client.query(
                `SELECT option_key, option_json, is_correct FROM question_option
                 WHERE question_id = $1 AND language = 'EN' ORDER BY option_key ASC`,
                [question_id]
            );

            // Build the new body_json, solution_json, difficulty from submitted + current values
            const newBodyJson = { ...(currentRow.body_json || {}), text: question_text };
            const newDifficulty   = difficulty   ?? currentRow.cur_diff;
            const newCorrectLabel = correct_option ?? currentRow.correct_option_label;

            let newSolutionJson = currentRow.solution_json || {};
            if (solution_text !== undefined) {
                newSolutionJson = { ...newSolutionJson, solution_text };
            }

            // Keep provenance: note the old question_id as previous_version
            const newMeta = {
                ...(currentRow.meta_json || {}),
                previous_question_id: question_id,
                edited_at: new Date().toISOString(),
            };

            // Insert new question_version
            await client.query(`
                INSERT INTO question_version (
                    question_id, version_no, language, status,
                    paper_session_id, exam_section_id,
                    body_json, solution_json, question_type,
                    subtype, difficulty, has_image, correct_option_label,
                    source_question_no, meta_json, created_at, updated_at
                ) VALUES (
                    $1, 1, 'EN', 'MANUALLY_CORRECTED',
                    NULL, $2,
                    $3, $4, $5,
                    $6, $7, $8, $9,
                    $10, $11, NOW(), NOW()
                )
            `, [
                newId, currentRow.exam_section_id,
                JSON.stringify(newBodyJson), JSON.stringify(newSolutionJson),
                currentRow.question_type || 'MCQ',
                currentRow.subtype, newDifficulty, currentRow.has_image, newCorrectLabel,
                currentRow.source_question_no, JSON.stringify(newMeta),
            ]);

            // Insert options — apply any text/correct edits from the submitted options
            const optionMap = {};
            for (const o of (options || [])) optionMap[o.key] = o.text;

            for (const opt of optsRes.rows) {
                const text = optionMap[opt.option_key] !== undefined
                    ? optionMap[opt.option_key]
                    : (opt.option_json?.text ?? '');
                const isCorrect = newCorrectLabel
                    ? opt.option_key === newCorrectLabel
                    : opt.is_correct;

                await client.query(`
                    INSERT INTO question_option (question_id, version_no, language, option_key, option_json, is_correct)
                    VALUES ($1, 1, 'EN', $2, $3, $4)
                `, [newId, opt.option_key, JSON.stringify({ ...(opt.option_json || {}), text }), isCorrect]);
            }

            // Re-point mock_test_question to new question_id
            await client.query(`
                UPDATE mock_test_question
                SET question_id = $1, slot_difficulty = $2, updated_at = NOW()
                WHERE mock_test_id = $3 AND question_id = $4
            `, [newId, newDifficulty, mock_test_id, question_id]);

            // Delete old copied question
            await client.query(`DELETE FROM question_option WHERE question_id = $1`, [question_id]);
            await client.query(`DELETE FROM question_version WHERE question_id = $1`, [question_id]);

            await client.query('COMMIT');
            return NextResponse.json({ success: true, new_question_id: newId });
        }

        // ── NO STEM CHANGE: update in place ──────────────────────────────────

        // Update question text if provided (but identical — no-op effectively, still touch updated_at)
        if (question_text !== undefined) {
            await client.query(`
                UPDATE question_version
                SET body_json = jsonb_set(COALESCE(body_json, '{}'), '{text}', $1::jsonb),
                    updated_at = NOW()
                WHERE question_id = $2 AND language = 'EN'
            `, [JSON.stringify(question_text), question_id]);
        }

        // Update correct answer + difficulty + solution
        const updates = [];
        const params  = [];
        let idx = 1;

        if (correct_option !== undefined) {
            updates.push(`correct_option_label = $${idx++}`);
            params.push(correct_option);
        }
        if (difficulty !== undefined) {
            updates.push(`difficulty = $${idx++}`);
            params.push(difficulty);
        }
        if (solution_text !== undefined) {
            updates.push(`solution_json = jsonb_set(COALESCE(solution_json, '{}'), '{solution_text}', $${idx++}::jsonb)`);
            params.push(JSON.stringify(solution_text));
        }
        if (updates.length > 0) {
            updates.push(`updated_at = NOW()`);
            params.push(question_id);
            await client.query(
                `UPDATE question_version SET ${updates.join(', ')} WHERE question_id = $${idx} AND language = 'EN'`,
                params
            );
        }

        // Update options
        if (options?.length > 0) {
            for (const opt of options) {
                await client.query(`
                    UPDATE question_option
                    SET option_json = jsonb_set(COALESCE(option_json, '{}'), '{text}', $1::jsonb),
                        is_correct  = ($2 = option_key)
                    WHERE question_id = $3 AND option_key = $4 AND language = 'EN'
                `, [JSON.stringify(opt.text), correct_option || '', question_id, opt.key]);
            }
        } else if (correct_option !== undefined) {
            await client.query(`
                UPDATE question_option SET is_correct = (option_key = $1)
                WHERE question_id = $2 AND language = 'EN'
            `, [correct_option, question_id]);
        }

        // Sync slot_difficulty
        if (difficulty !== undefined && mock_test_id) {
            await client.query(`
                UPDATE mock_test_question SET slot_difficulty = $1
                WHERE mock_test_id = $2 AND question_id = $3
            `, [difficulty, mock_test_id, question_id]);
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('mock-test/builder/override error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
