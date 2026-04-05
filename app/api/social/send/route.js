import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { channel_id, content_text, image_url, parse_mode } = await req.json();
    if (!content_text && !image_url) {
        return NextResponse.json({ error: 'content_text or image_url required' }, { status: 400 });
    }

    try {
        // Get channel info
        let chatId = process.env.TELEGRAM_CHAT_ID;
        let botToken = process.env.TELEGRAM_BOT_TOKEN;
        let resolvedChannelId = null;

        if (channel_id) {
            try {
                const chRes = await db.query(
                    `SELECT channel_id, channel_identifier, config_json FROM social_channel WHERE channel_id = $1 AND is_active = true`,
                    [channel_id]
                );
                if (chRes.rows.length > 0) {
                    chatId = chRes.rows[0].channel_identifier || chatId;
                    const envKey = chRes.rows[0].config_json?.bot_token_env || 'TELEGRAM_BOT_TOKEN';
                    botToken = process.env[envKey] || botToken;
                    resolvedChannelId = chRes.rows[0].channel_id;
                }
            } catch (dbErr) {
                console.error('Channel lookup failed, using env vars:', dbErr.message);
            }
        }

        if (!botToken || !chatId) {
            return NextResponse.json({ error: 'Bot token or chat ID not configured' }, { status: 500 });
        }

        let telegramRes, telegramData;

        if (image_url) {
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

        // Log to DB (non-blocking — don't fail if this errors)
        try {
            await db.query(`
                INSERT INTO social_post (content_text, image_url, status, sent_at, created_by, content_json, channel_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                content_text,
                image_url || null,
                telegramData.ok ? 'SENT' : 'FAILED',
                telegramData.ok ? new Date().toISOString() : null,
                user.id,
                { telegram_response: telegramData, parse_mode: parse_mode || 'HTML' },
                resolvedChannelId,
            ]);
        } catch (logErr) {
            console.error('Post log failed:', logErr.message);
        }

        if (!telegramData.ok) {
            return NextResponse.json({ error: 'Telegram API error', details: telegramData.description }, { status: 502 });
        }

        return NextResponse.json({ success: true, message_id: telegramData.result?.message_id });

    } catch (e) {
        console.error('social/send error:', e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
