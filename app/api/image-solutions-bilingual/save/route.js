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

    const { eng_id, eng_version, hin_id, hin_version, link_id, parsed_en, parsed_hi, subtype, difficulty, action } = body;

    if (!eng_id || eng_version == null) {
        return NextResponse.json({ error: 'eng_id and eng_version are required' }, { status: 400 });
    }

    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');

        // Flag action
        if (action === 'flag') {
            if (link_id) {
                await client.query(`
                    UPDATE question_links SET status = 'FLAGGED', updated_at = NOW() WHERE id = $1
                `, [link_id]);
            }
            await client.query(`
                UPDATE question_version SET status = 'FLAGGED', updated_at = NOW()
                WHERE question_id = $1 AND version_no = $2 AND language = 'EN'
            `, [eng_id, eng_version]);
            if (hin_id && hin_version != null) {
                await client.query(`
                    UPDATE question_version SET status = 'FLAGGED', updated_at = NOW()
                    WHERE question_id = $1 AND version_no = $2 AND language = 'HI'
                `, [hin_id, hin_version]);
            }
            await client.query('COMMIT');
            return NextResponse.json({ success: true, action: 'flagged' });
        }

        // Save action — separate EN and HI with independent correct options
        const enAnswer = parsed_en?.correct_option_label;
        const hiAnswer = parsed_hi?.correct_option_label;
        if (!enAnswer) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'EN correct_option_label is required' }, { status: 400 });
        }

        const difficultyVal = difficulty || parsed_en?.difficulty || parsed_hi?.difficulty || null;

        // Save EN
        if (parsed_en) {
            const solutionJson = JSON.stringify({
                ...parsed_en.full_json,
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
                WHERE question_id = $9 AND version_no = $10 AND language = 'EN'
            `, [
                solutionJson,
                subtype || parsed_en.subtype || '',
                enAnswer,
                parsed_en.final_answer_text || '',
                parsed_en.recheck_options || false,
                parsed_en.figure_helpful || false,
                parsed_en.figure_prompt || '',
                difficultyVal,
                eng_id,
                eng_version,
            ]);

            // Mark correct option for EN (using EN-specific answer)
            await client.query(`
                UPDATE question_option SET is_correct = (option_key = $1)
                WHERE question_id = $2 AND language = 'EN'
            `, [enAnswer, eng_id]);
        }

        // Save HI (with HI-specific correct option, which may differ from EN)
        if (hin_id && hin_version != null && parsed_hi) {
            const hiCorrect = hiAnswer || enAnswer;
            const solutionJson = JSON.stringify({
                ...parsed_hi.full_json,
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
                WHERE question_id = $9 AND version_no = $10 AND language = 'HI'
            `, [
                solutionJson,
                subtype || parsed_hi.subtype || '',
                hiCorrect,
                parsed_hi.final_answer_text || '',
                parsed_hi.recheck_options || false,
                parsed_hi.figure_helpful || false,
                parsed_hi.figure_prompt || '',
                difficultyVal,
                hin_id,
                hin_version,
            ]);

            // Mark correct option for HI (using HI-specific answer)
            await client.query(`
                UPDATE question_option SET is_correct = (option_key = $1)
                WHERE question_id = $2 AND language = 'HI'
            `, [hiCorrect, hin_id]);
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('image-solutions-bilingual/save error:', error);
        return NextResponse.json({ error: 'Failed to save', details: error.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
