import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export async function POST(request) {
    const user = await getCurrentUser();
    if (!user || !user.isAdmin) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { paper_session_id, solutions } = body;
    if (!paper_session_id || !Array.isArray(solutions)) {
        return NextResponse.json({ error: 'paper_session_id and solutions array are required' }, { status: 400 });
    }

    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');

        let saved = 0;

        for (const sol of solutions) {
            const { question_id, version_no, answer_label, solution_text, difficulty, tags, full_json, mock_worthiness } = sol;
            if (!question_id || version_no == null) continue;

            if (full_json) {
                // Rich format: save full solution_json with reviewer info
                const solutionJson = JSON.stringify({
                    ...full_json,
                    reviewed_by: user.id,
                    saved_at: new Date().toISOString(),
                });

                await client.query(`
                    UPDATE question_version SET
                        solution_json = $1::jsonb,
                        difficulty = COALESCE($4, difficulty),
                        mock_worthiness = COALESCE($5, mock_worthiness),
                        updated_at = NOW()
                    WHERE question_id = $2 AND version_no = $3 AND language = 'EN'
                `, [solutionJson, question_id, version_no, difficulty || null, mock_worthiness || null]);
            } else {
                // Legacy format: basic solution_json
                const solutionJson = JSON.stringify({
                    answer_label: answer_label || null,
                    solution_text: solution_text || null,
                    tags: tags || null,
                    updated_at: new Date().toISOString(),
                });

                await client.query(`
                    UPDATE question_version
                    SET
                        solution_json = $1::jsonb,
                        difficulty = COALESCE(NULLIF($2, ''), difficulty),
                        updated_at = NOW()
                    WHERE question_id = $3
                      AND version_no = $4
                `, [solutionJson, difficulty || '', question_id, version_no]);
            }

            // Update is_correct on question_option if answer_label provided
            if (answer_label) {
                await client.query(`
                    UPDATE question_option
                    SET is_correct = (option_key = $1)
                    WHERE question_id = $2
                      AND language = 'EN'
                `, [answer_label, question_id]);
            }

            saved++;
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true, saved });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('solution-review/save error:', error);
        return NextResponse.json({ error: 'Failed to save solutions', details: error.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
