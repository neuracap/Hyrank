import { NextResponse } from 'next/server';
import db from '@/lib/db';
import questionCleaner from '@/lib/questionCleaner';

export async function POST(req) {
    const client = await db.connect();

    try {
        const body = await req.json();
        const { paper_session_id } = body;

        if (!paper_session_id) {
            return NextResponse.json({ error: 'Missing paper_session_id' }, { status: 400 });
        }

        await client.query('BEGIN');

        let stats = {
            total: 0,
            cleaned: 0,
            unchanged: 0
        };

        // 1. Fetch all questions for this session
        const qRes = await client.query(`
            SELECT question_id, version_no, language, body_json
            FROM question_version
            WHERE paper_session_id = $1
        `, [paper_session_id]);

        for (const row of qRes.rows) {
            stats.total++;
            const originalText = row.body_json.text || '';
            const cleanedText = questionCleaner.cleanText(originalText);

            if (originalText !== cleanedText) {
                // Update
                await client.query(`
                    UPDATE question_version 
                    SET body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text))
                    WHERE question_id = $2 AND version_no = $3 AND language = $4
                `, [cleanedText, row.question_id, row.version_no, row.language]);

                stats.cleaned++;
            } else {
                stats.unchanged++;
            }
        }

        // 2. Fetch and clean options
        // We'll iterate options linked to these questions. 
        // Note: paper_session_id might not be directly in question_option, but we can join via question_version or use the provided method if we stored paper_Session_id on options??
        // Wait, schema check. question_option has (question_id, version_no, language).
        // We can select options based on the questions we found.

        // Actually, let's grab all options for these questions.
        // It's safer to query options by the questions we just found to avoid cleaning unrelated versions?
        // But question_version is specific to paper_session_id. So we are good.

        const optRes = await client.query(`
            SELECT qo.question_id, qo.version_no, qo.language, qo.option_key, qo.option_json
            FROM question_option qo
            JOIN question_version qv ON qo.question_id = qv.question_id 
                AND qo.version_no = qv.version_no 
                AND qo.language = qv.language
            WHERE qv.paper_session_id = $1
        `, [paper_session_id]);

        for (const row of optRes.rows) {
            const originalOptText = row.option_json.text || '';
            const cleanedOptText = questionCleaner.cleanText(originalOptText);

            if (originalOptText !== cleanedOptText) {
                await client.query(`
                    UPDATE question_option
                    SET option_json = jsonb_set(option_json, '{text}', to_jsonb($1::text))
                    WHERE question_id = $2 AND version_no = $3 AND language = $4 AND option_key = $5
                `, [cleanedOptText, row.question_id, row.version_no, row.language, row.option_key]);
                // We count option changes as part of the overall "cleaning" or separate?
                // Let's just track them vaguely or merge into stats.
                // For simplicity, let's just log it effectively.
                stats.cleaned++;
            }
        }

        await client.query('COMMIT');

        return NextResponse.json({ success: true, stats });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error cleaning paper:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
