import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export async function POST(req) {
    const user = await getCurrentUser();
    const VERIFY_REVIEWER_IDS = [2, 3];
    if (!user?.isAdmin && !VERIFY_REVIEWER_IDS.includes(user?.id)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let client;
    try {
        client = await db.connect();
        const { id, version_no, language, question_text, options, status: saveStatus } = await req.json();

        if (!id || !version_no || !language) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const isFlagged = saveStatus === 'FLAGGED';

        await client.query('BEGIN');

        // Update question text, status, and is_verified (only verify on MANUALLY_CORRECTED)
        await client.query(`
            UPDATE question_version
            SET
                body_json   = jsonb_set(body_json, '{text}', to_jsonb($1::text)),
                is_verified = $5,
                status      = $6,
                updated_at  = NOW()
            WHERE question_id = $2 AND version_no = $3 AND language = $4
        `, [question_text, id, version_no, language, !isFlagged, isFlagged ? 'FLAGGED' : 'MANUALLY_CORRECTED']);

        // Update options
        if (options && options.length > 0) {
            for (const opt of options) {
                const existing = await client.query(`
                    SELECT COUNT(*) as count FROM question_option
                    WHERE question_id = $1 AND version_no = $2 AND language = $3 AND option_key = $4
                `, [id, version_no, language, opt.opt_label]);

                if (parseInt(existing.rows[0].count) > 0) {
                    await client.query(`
                        UPDATE question_option
                        SET option_json = jsonb_set(option_json, '{text}', to_jsonb($1::text))
                        WHERE question_id = $2 AND version_no = $3 AND language = $4 AND option_key = $5
                    `, [opt.opt_text || '', id, version_no, language, opt.opt_label]);
                } else {
                    await client.query(`
                        INSERT INTO question_option (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                        VALUES ($1, $2, $3, $4, jsonb_build_object('text', $5::text), false, NOW())
                    `, [id, version_no, language, opt.opt_label, opt.opt_text || '']);
                }
            }
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true });

    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error('verify-unlink save error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
