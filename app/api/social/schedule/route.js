import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * POST /api/social/schedule
 * Schedule a post for later.
 * Body: { channel_id?, content_text, image_url?, scheduled_at, parse_mode?, type?, poll_data? }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { channel_id, content_text, image_url, scheduled_at, parse_mode, type, poll_data, question_ids } = await req.json();
    if (!scheduled_at) {
        return NextResponse.json({ error: 'scheduled_at is required' }, { status: 400 });
    }

    try {
        const res = await db.query(`
            INSERT INTO social_post (channel_id, content_text, image_url, scheduled_at, status, created_by, content_json, question_ids)
            VALUES ($1, $2, $3, $4, 'SCHEDULED', $5, $6, $7)
            RETURNING post_id
        `, [
            channel_id || null,
            content_text,
            image_url || null,
            scheduled_at,
            user.id,
            { parse_mode: parse_mode || 'HTML', type: type || 'message', poll_data },
            question_ids || null,
        ]);

        return NextResponse.json({ success: true, post_id: res.rows[0].post_id });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
