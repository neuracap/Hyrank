import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export async function POST(request) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { question_id, version_no, language, action } = body;
    if (!question_id || version_no == null) {
        return NextResponse.json({ error: 'question_id and version_no are required' }, { status: 400 });
    }

    // Flag action
    if (action === 'flag') {
        let client;
        try {
            client = await db.connect();
            await client.query('BEGIN');
            await client.query(`
                UPDATE question_version SET status = 'FLAGGED', updated_at = NOW()
                WHERE question_id = $1 AND version_no = $2 AND language = $3
            `, [question_id, version_no, language || 'EN']);
            await client.query('COMMIT');
            return NextResponse.json({ success: true, action: 'flagged' });
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            console.error('image-solutions/save flag error:', error);
            return NextResponse.json({ error: 'Failed to flag', details: error.message }, { status: 500 });
        } finally {
            client?.release();
        }
    }

    // Support both new rich format (parsed) and old format (answer_label + solution_text)
    const isRichFormat = !!body.parsed;

    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');

        if (isRichFormat) {
            const { parsed } = body;
            const fullJson = parsed.full_json || {};
            const answerLabel = parsed.correct_option_label || fullJson.correct_option_label;

            if (!answerLabel) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'correct_option_label is required' }, { status: 400 });
            }

            const solutionJson = JSON.stringify({
                ...fullJson,
                reviewed_by: user.id,
                saved_at: new Date().toISOString(),
            });

            await client.query(`
                UPDATE question_version SET
                    solution_json = $1::jsonb,
                    subtype = NULLIF($2, ''),
                    correct_option_label = NULLIF($3, ''),
                    final_answer_text = NULLIF($4, ''),
                    recheck_options = $5,
                    solution_status = 'DONE',
                    solution_generated_at = NOW(),
                    solution_figure_helpful = $6,
                    solution_figure_prompt = NULLIF($7, ''),
                    difficulty = $8,
                    updated_at = NOW()
                WHERE question_id = $9 AND version_no = $10 AND language = $11
            `, [
                solutionJson,
                parsed.subtype || '',
                answerLabel,
                parsed.final_answer_text || '',
                parsed.recheck_options || false,
                parsed.figure_helpful || false,
                parsed.figure_prompt || '',
                parsed.difficulty || null,
                question_id,
                version_no,
                language || 'EN',
            ]);

            // Mark correct option in EN and HI
            await client.query(`
                UPDATE question_option
                SET is_correct = (option_key = $1)
                WHERE question_id = $2 AND language = 'EN'
            `, [answerLabel, question_id]);

            await client.query(`
                UPDATE question_option
                SET is_correct = (option_key = $1)
                WHERE question_id = $2 AND language = 'HI'
            `, [answerLabel, question_id]);

        } else {
            // Legacy format: answer_label + solution_text
            const { answer_label, solution_text } = body;
            if (!answer_label) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'answer_label is required' }, { status: 400 });
            }

            const solutionJson = JSON.stringify({
                answer_label,
                solution_text: solution_text || null,
                updated_at: new Date().toISOString(),
                reviewed_by: user.id,
            });

            await client.query(`
                UPDATE question_version
                SET solution_json = $1::jsonb, updated_at = NOW()
                WHERE question_id = $2 AND version_no = $3
            `, [solutionJson, question_id, version_no]);

            await client.query(`
                UPDATE question_option
                SET is_correct = (option_key = $1)
                WHERE question_id = $2 AND language = 'EN'
            `, [answer_label, question_id]);

            await client.query(`
                UPDATE question_option
                SET is_correct = (option_key = $1)
                WHERE question_id = $2 AND language = 'HI'
            `, [answer_label, question_id]);
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('image-solutions/save error:', error);
        return NextResponse.json({ error: 'Failed to save solution', details: error.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
