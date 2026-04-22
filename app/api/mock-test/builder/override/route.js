import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/mock-test/builder/override
 * Save edits to a copied mock-test question.
 * Updates question_version + question_option directly — no special columns needed.
 *
 * Body: {
 *   question_id,      — the COPIED question_id (not the source)
 *   question_text?,
 *   options?,         — [{ key, text }]
 *   correct_option?,
 *   solution_text?,
 *   difficulty?,      — 1 | 2 | 3
 *   mock_test_id?,    — to also update slot_difficulty on mock_test_question
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

        // Update question text
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
        const params = [];
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
            // Just update is_correct flags without changing text
            await client.query(`
                UPDATE question_option SET is_correct = (option_key = $1)
                WHERE question_id = $2 AND language = 'EN'
            `, [correct_option, question_id]);
        }

        // Sync slot_difficulty on mock_test_question
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
