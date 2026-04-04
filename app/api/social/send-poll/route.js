import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * POST /api/social/send-poll
 * Send a question as a Telegram native poll.
 * Body: { channel_id?, question_text, options: string[], correct_option_index, explanation? }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { channel_id, question_text, options, correct_option_index, explanation, question_id } = await req.json();
    if (!question_text || !options || options.length < 2) {
        return NextResponse.json({ error: 'question_text and at least 2 options required' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        let chatId = process.env.TELEGRAM_CHAT_ID;
        let botToken = process.env.TELEGRAM_BOT_TOKEN;

        if (channel_id) {
            const chRes = await client.query(
                `SELECT channel_identifier, config_json FROM social_channel WHERE channel_id = $1`,
                [channel_id]
            );
            if (chRes.rows.length > 0) {
                chatId = chRes.rows[0].channel_identifier;
                botToken = process.env[chRes.rows[0].config_json?.bot_token_env || 'TELEGRAM_BOT_TOKEN'];
            }
        }

        if (!botToken || !chatId) {
            return NextResponse.json({ error: 'Bot token or chat ID not configured' }, { status: 500 });
        }

        const pollBody = {
            chat_id: chatId,
            question: question_text.substring(0, 300), // Telegram poll limit
            options: options.map(o => o.substring(0, 100)), // Option limit
            type: 'quiz',
            correct_option_id: correct_option_index || 0,
            is_anonymous: true,
        };

        if (explanation) {
            pollBody.explanation = explanation.substring(0, 200);
            pollBody.explanation_parse_mode = 'HTML';
        }

        const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPoll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pollBody),
        });

        const telegramData = await telegramRes.json();

        // Log
        await client.query(`
            INSERT INTO social_post (channel_id, content_text, status, sent_at, created_by, content_json)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            channel_id || null,
            `[POLL] ${question_text}`,
            telegramData.ok ? 'SENT' : 'FAILED',
            telegramData.ok ? new Date().toISOString() : null,
            user.id,
            { type: 'poll', question_id, options, correct_option_index, telegram_response: telegramData },
        ]);

        if (!telegramData.ok) {
            return NextResponse.json({ error: telegramData.description }, { status: 502 });
        }

        return NextResponse.json({ success: true, message_id: telegramData.result?.message_id });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
