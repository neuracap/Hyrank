import db from '@/lib/db';
import { NextResponse } from 'next/server';

export async function POST(request) {
    const body = await request.json();
    const { link_id, english, hindi } = body;

    if (!link_id || !english || !hindi) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');

        // 1. Update English Question
        await client.query(`
            UPDATE question_version 
            SET body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text)),
                updated_at = NOW()
            WHERE question_id = $2 AND version_no = $3
        `, [english.question_text, english.id, english.version]);

        // 2. Upsert English Options (INSERT if row missing, UPDATE if exists)
        for (const opt of english.options) {
            await client.query(`
                INSERT INTO question_option (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                VALUES ($2, $3, 'EN', $4, jsonb_build_object('text', $1::text), false, NOW())
                ON CONFLICT ON CONSTRAINT unique_question_option_key
                DO UPDATE SET option_json = jsonb_set(question_option.option_json, '{text}', to_jsonb($1::text))
            `, [opt.opt_text || "", english.id, english.version, opt.opt_label]);
        }

        // 3. Update Hindi Question
        await client.query(`
            UPDATE question_version 
            SET body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text)),
                updated_at = NOW()
            WHERE question_id = $2 AND version_no = $3
        `, [hindi.question_text, hindi.id, hindi.version]);

        // 4. Upsert Hindi Options (INSERT if row missing, UPDATE if exists)
        for (const opt of hindi.options) {
            await client.query(`
                INSERT INTO question_option (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                VALUES ($2, $3, 'HI', $4, jsonb_build_object('text', $1::text), false, NOW())
                ON CONFLICT ON CONSTRAINT unique_question_option_key
                DO UPDATE SET option_json = jsonb_set(question_option.option_json, '{text}', to_jsonb($1::text))
            `, [opt.opt_text || "", hindi.id, hindi.version, opt.opt_label]);
        }

        // 5. Update Link Status and Score
        const newStatus = body.status || 'MANUALLY_CORRECTED';
        await client.query(`
            UPDATE question_links
            SET updated_score = 1.0,
                status = $2
            WHERE id = $1
        `, [link_id, newStatus]);

        await client.query('COMMIT');

        return NextResponse.json({ success: true });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Save error:', error);
        console.error('Error stack:', error.stack);
        console.error('Error message:', error.message);
        return NextResponse.json({
            error: 'Failed to save changes',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }, { status: 500 });
    } finally {
        client?.release();
    }
}
