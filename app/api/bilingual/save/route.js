import db from '@/lib/db';
import { NextResponse } from 'next/server';

export async function POST(request) {
    const body = await request.json();
    const { link_id, english, hindi } = body;

    if (!link_id || !english || !hindi) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        // 1. Update English Question
        await client.query(`
            UPDATE question_version 
            SET body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text)),
                updated_at = NOW()
            WHERE question_id = $2 AND version_no = $3
        `, [english.question_text, english.id, english.version]);

        // 2. Update English Options
        for (const opt of english.options) {
            await client.query(`
                UPDATE question_option 
                SET option_json = jsonb_set(option_json, '{text}', to_jsonb($1::text))
                WHERE question_id = $2 AND version_no = $3 AND language = 'EN' AND option_key = $4
            `, [opt.opt_text || "", english.id, english.version, opt.opt_label]);
        }

        // 3. Update Hindi Question
        await client.query(`
            UPDATE question_version 
            SET body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text)),
                updated_at = NOW()
            WHERE question_id = $2 AND version_no = $3
        `, [hindi.question_text, hindi.id, hindi.version]);

        // 4. Update Hindi Options
        for (const opt of hindi.options) {
            await client.query(`
                UPDATE question_option 
                SET option_json = jsonb_set(option_json, '{text}', to_jsonb($1::text))
                WHERE question_id = $2 AND version_no = $3 AND language = 'HI' AND option_key = $4
            `, [opt.opt_text || "", hindi.id, hindi.version, opt.opt_label]);
        }

        // 5. Update Link Status and Score
        await client.query(`
            UPDATE question_links
            SET updated_score = 1.0,
                status = 'MANUALLY_CORRECTED'
            WHERE id = $1
        `, [link_id]);

        await client.query('COMMIT');

        return NextResponse.json({ success: true });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Save error:', error);
        console.error('Error stack:', error.stack);
        console.error('Error message:', error.message);
        return NextResponse.json({
            error: 'Failed to save changes',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }, { status: 500 });
    } finally {
        client.release();
    }
}
