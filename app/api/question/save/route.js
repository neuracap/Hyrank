import { NextResponse } from 'next/server';
import db from '@/lib/db';

// DEPLOYMENT v2 - 2026-02-05 13:47 IST - UPDATE-only logic (NO ON CONFLICT)
export async function POST(req) {
    console.log('[SAVE v2] Question save using UPDATE-only approach');
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


        // 2. Update/Insert Options
        if (options && options.length > 0) {
            for (const opt of options) {
                // Check if option exists
                const existingOpt = await client.query(`
                    SELECT id FROM question_option 
                    WHERE question_id = $1 AND version_no = $2 AND language = $3 AND option_key = $4
                `, [id, version_no, language, opt.opt_label]);

                if (existingOpt.rows.length > 0) {
                    // UPDATE existing option
                    await client.query(`
                        UPDATE question_option 
                        SET option_json = jsonb_set(option_json, '{text}', to_jsonb($1::text))
                        WHERE question_id = $2 AND version_no = $3 AND language = $4 AND option_key = $5
                    `, [opt.opt_text || "", id, version_no, language, opt.opt_label]);
                } else {
                    // INSERT new option (for missing C, D, etc.)
                    await client.query(`
                        INSERT INTO question_option (question_id, version_no, language, option_key, option_json)
                        VALUES ($1, $2, $3, $4, jsonb_build_object('text', $5::text))
                    `, [id, version_no, language, opt.opt_label, opt.opt_text || ""]);
                }
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
