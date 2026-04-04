import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * POST /api/social/process-scheduled
 * Process all due scheduled posts — sends them now.
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await db.connect();
    try {
        // Find due posts
        const dueRes = await client.query(`
            SELECT sp.*, sc.channel_identifier, sc.config_json
            FROM social_post sp
            LEFT JOIN social_channel sc ON sc.channel_id = sp.channel_id
            WHERE sp.status = 'SCHEDULED' AND sp.scheduled_at <= NOW()
            ORDER BY sp.scheduled_at ASC
        `);

        const duePosts = dueRes.rows;
        if (duePosts.length === 0) {
            return NextResponse.json({ success: true, processed: 0, message: 'No due posts' });
        }

        let sent = 0;
        let failed = 0;

        for (const post of duePosts) {
            const chatId = post.channel_identifier || process.env.TELEGRAM_CHAT_ID;
            const botToken = process.env[post.config_json?.bot_token_env || 'TELEGRAM_BOT_TOKEN'];

            if (!botToken || !chatId) {
                await client.query(`UPDATE social_post SET status = 'FAILED', error_message = 'Missing bot token or chat ID' WHERE post_id = $1`, [post.post_id]);
                failed++;
                continue;
            }

            try {
                let telegramRes, telegramData;
                const postType = post.content_json?.type || 'message';

                if (postType === 'poll' && post.content_json?.poll_data) {
                    const pd = post.content_json.poll_data;
                    telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPoll`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chatId,
                            question: pd.question.substring(0, 300),
                            options: pd.options.map(o => o.substring(0, 100)),
                            type: 'quiz',
                            correct_option_id: pd.correct_option_index || 0,
                            is_anonymous: true,
                            explanation: pd.explanation?.substring(0, 200) || undefined,
                        }),
                    });
                } else if (post.image_url) {
                    telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chatId,
                            photo: post.image_url,
                            caption: post.content_text || '',
                            parse_mode: post.content_json?.parse_mode || 'HTML',
                        }),
                    });
                } else {
                    telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chatId,
                            text: post.content_text,
                            parse_mode: post.content_json?.parse_mode || 'HTML',
                            disable_web_page_preview: true,
                        }),
                    });
                }

                telegramData = await telegramRes.json();

                if (telegramData.ok) {
                    await client.query(`UPDATE social_post SET status = 'SENT', sent_at = NOW() WHERE post_id = $1`, [post.post_id]);
                    sent++;
                } else {
                    await client.query(`UPDATE social_post SET status = 'FAILED', error_message = $1 WHERE post_id = $2`, [telegramData.description, post.post_id]);
                    failed++;
                }
            } catch (e) {
                await client.query(`UPDATE social_post SET status = 'FAILED', error_message = $1 WHERE post_id = $2`, [e.message, post.post_id]);
                failed++;
            }
        }

        return NextResponse.json({ success: true, processed: duePosts.length, sent, failed });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
