import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function POST(req) {
    const client = await db.connect();

    try {
        const body = await req.json();
        const { id, version_no, language, question_text, options, source_question_no } = body;

        if (!id || !version_no || !language) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        await client.query('BEGIN');

        // 1. Update Question Text & Source Question No
        // We update body_json->>'text' and source_question_no column
        await client.query(`
            UPDATE question_version 
            SET 
                body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text)),
                source_question_no = COALESCE($5, source_question_no)
            WHERE question_id = $2 AND version_no = $3 AND language = $4
        `, [question_text, id, version_no, language, source_question_no]);

        // 2. Update Options
        if (options && options.length > 0) {
            for (const opt of options) {
                // We use INSERT ON CONFLICT (upsert) to handle both new and existing options
                // Need to ensure opt_text is wrapped in the correct JSON structure: { "text": "..." }
                // Schema: question_id, version_no, language, option_key, option_json, is_correct, created_at

                await client.query(`
                    INSERT INTO question_option (question_id, version_no, language, option_key, option_json)
                    VALUES ($1, $2, $3, $4, jsonb_build_object('text', $5::text))
                    ON CONFLICT (question_id, version_no, language, option_key)
                    DO UPDATE SET 
                        option_json = jsonb_set(question_option.option_json, '{text}', to_jsonb($5::text))
                `, [id, version_no, language, opt.opt_label, opt.opt_text]);
            }
        }

        await client.query('COMMIT');

        return NextResponse.json({ success: true });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error saving question:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
