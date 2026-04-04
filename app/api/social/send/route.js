import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * POST /api/social/send
 * Send a message to a Telegram channel.
 * Body: { channel_id?, content_text, image_url?, parse_mode? }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { channel_id, content_text, image_url, parse_mode } = await req.json();
    if (!content_text && !image_url) {
        return NextResponse.json({ error: 'content_text or image_url required' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        // Get channel info
        let chatId, botToken;
        if (channel_id) {
            const chRes = await client.query(
                `SELECT channel_identifier, config_json FROM social_channel WHERE channel_id = $1 AND is_active = true`,
                [channel_id]
            );
            if (chRes.rows.length === 0) {
                return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
            }
            chatId = chRes.rows[0].channel_identifier;
            const envKey = chRes.rows[0].config_json?.bot_token_env || 'TELEGRAM_BOT_TOKEN';
            botToken = process.env[envKey];
        } else {
            chatId = process.env.TELEGRAM_CHAT_ID;
            botToken = process.env.TELEGRAM_BOT_TOKEN;
        }

        if (!botToken || !chatId) {
            return NextResponse.json({ error: 'Bot token or chat ID not configured' }, { status: 500 });
        }

        let telegramRes, telegramData;

        if (image_url) {
            // Send photo with caption
            telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    photo: image_url,
                    caption: content_text || '',
                    parse_mode: parse_mode || 'HTML',
                }),
            });
        } else {
            // Send text message
            telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: content_text,
                    parse_mode: parse_mode || 'HTML',
                    disable_web_page_preview: true,
                }),
            });
        }

        telegramData = await telegramRes.json();

        // Log the post
        await client.query(`
            INSERT INTO social_post (channel_id, content_text, image_url, status, sent_at, created_by, content_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            channel_id || null,
            content_text,
            image_url || null,
            telegramData.ok ? 'SENT' : 'FAILED',
            telegramData.ok ? new Date().toISOString() : null,
            user.id,
            { telegram_response: telegramData, parse_mode: parse_mode || 'HTML' },
        ]);

        if (!telegramData.ok) {
            return NextResponse.json({
                error: 'Telegram API error',
                details: telegramData.description,
            }, { status: 502 });
        }

        return NextResponse.json({ success: true, message_id: telegramData.result?.message_id });

    } catch (e) {
        console.error('social/send error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
