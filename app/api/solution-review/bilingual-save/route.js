import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/solution-review/bilingual-save
 * Save solution_json for a bilingual pair (EN and/or HI).
 * Body: {
 *   link_id,
 *   en: { question_id, version_no, solution_json, correct_option_label? },
 *   hi: { question_id, version_no, solution_json, correct_option_label? }
 * }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { link_id, en, hi, difficulty } = body;
    if (!en && !hi) {
        return NextResponse.json({ error: 'At least one of en or hi is required' }, { status: 400 });
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        // Save EN solution
        if (en?.question_id && en.solution_json) {
            const solutionJson = JSON.stringify({
                ...en.solution_json,
                reviewed_by: user.id,
                saved_at: new Date().toISOString(),
            });

            await client.query(`
                UPDATE question_version SET
                    solution_json = $1::jsonb,
                    correct_option_label = COALESCE(NULLIF($2, ''), correct_option_label),
                    difficulty = COALESCE($5, difficulty),
                    solution_status = 'DONE',
                    solution_generated_at = COALESCE(solution_generated_at, NOW()),
                    updated_at = NOW()
                WHERE question_id = $3 AND version_no = $4 AND language = 'EN'
            `, [solutionJson, en.correct_option_label || '', en.question_id, en.version_no || 1, difficulty || null]);

            // Update is_correct on options
            if (en.correct_option_label) {
                await client.query(`
                    UPDATE question_option SET is_correct = (option_key = $1)
                    WHERE question_id = $2 AND language = 'EN'
                `, [en.correct_option_label, en.question_id]);
            }
        }

        // Save HI solution
        if (hi?.question_id && hi.solution_json) {
            const solutionJson = JSON.stringify({
                ...hi.solution_json,
                reviewed_by: user.id,
                saved_at: new Date().toISOString(),
            });

            await client.query(`
                UPDATE question_version SET
                    solution_json = $1::jsonb,
                    correct_option_label = COALESCE(NULLIF($2, ''), correct_option_label),
                    difficulty = COALESCE($5, difficulty),
                    solution_status = 'DONE',
                    solution_generated_at = COALESCE(solution_generated_at, NOW()),
                    updated_at = NOW()
                WHERE question_id = $3 AND version_no = $4 AND language = 'HI'
            `, [solutionJson, hi.correct_option_label || '', hi.question_id, hi.version_no || 1, difficulty || null]);

            if (hi.correct_option_label) {
                await client.query(`
                    UPDATE question_option SET is_correct = (option_key = $1)
                    WHERE question_id = $2 AND language = 'HI'
                `, [hi.correct_option_label, hi.question_id]);
            }
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true });

    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('solution-review/bilingual-save error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
