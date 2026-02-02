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

        // 2. Delete and Re-insert English Options
        await client.query(`
            DELETE FROM question_option 
            WHERE question_id = $1 AND version_no = $2 AND language = 'EN'
        `, [english.id, english.version]);

        for (const opt of english.options) {
            const optJson = { text: opt.opt_text || "" };
            await client.query(`
                INSERT INTO question_option (question_id, version_no, language, option_key, option_json)
                VALUES ($1, $2, 'EN', $3, $4)
            `, [english.id, english.version, opt.opt_label, JSON.stringify(optJson)]);
        }

        // 3. Update Hindi Question
        await client.query(`
            UPDATE question_version 
            SET body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text)),
                updated_at = NOW()
            WHERE question_id = $2 AND version_no = $3
        `, [hindi.question_text, hindi.id, hindi.version]);

        // 4. Delete and Re-insert Hindi Options
        await client.query(`
            DELETE FROM question_option 
            WHERE question_id = $1 AND version_no = $2 AND language = 'HI'
        `, [hindi.id, hindi.version]);

        for (const opt of hindi.options) {
            const optJson = { text: opt.opt_text || "" };
            await client.query(`
                INSERT INTO question_option (question_id, version_no, language, option_key, option_json)
                VALUES ($1, $2, 'HI', $3, $4)
            `, [hindi.id, hindi.version, opt.opt_label, JSON.stringify(optJson)]);
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
