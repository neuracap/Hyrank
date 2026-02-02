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
            SET body_json = jsonb_set(body_json, '{text}', $1),
                updated_at = NOW()
            WHERE question_id = $2 AND version_no = $3
        `, [JSON.stringify(english.question_text), english.id, english.version]);

        // 2. Upsert English Options
        for (const opt of english.options) {
            // Create standard option JSON if not present
            const optJson = { text: opt.opt_text || "" };

            await client.query(`
                INSERT INTO question_option (question_id, version_no, language, option_key, option_json)
                VALUES ($1, $2, 'EN', $3, $4)
                ON CONFLICT (question_id, version_no, language, option_key)
                DO UPDATE SET option_json = jsonb_set(question_option.option_json, '{text}', $5)
            `, [english.id, english.version, opt.opt_label, JSON.stringify(optJson), JSON.stringify(opt.opt_text)]);
        }

        // 3. Update Hindi Question
        await client.query(`
            UPDATE question_version 
            SET body_json = jsonb_set(body_json, '{text}', $1),
                updated_at = NOW()
            WHERE question_id = $2 AND version_no = $3
        `, [JSON.stringify(hindi.question_text), hindi.id, hindi.version]);

        // 4. Upsert Hindi Options
        for (const opt of hindi.options) {
            const optJson = { text: opt.opt_text || "" };

            await client.query(`
                INSERT INTO question_option (question_id, version_no, language, option_key, option_json)
                VALUES ($1, $2, 'HI', $3, $4)
                ON CONFLICT (question_id, version_no, language, option_key)
                DO UPDATE SET option_json = jsonb_set(question_option.option_json, '{text}', $5)
            `, [hindi.id, hindi.version, opt.opt_label, JSON.stringify(optJson), JSON.stringify(opt.opt_text)]);
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
        return NextResponse.json({ error: 'Failed to save changes' }, { status: 500 });
    } finally {
        client.release();
    }
}
