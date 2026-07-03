import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const STAGES = ['QUEUED', 'VIDEO', 'EDIT', 'READY', 'PUBLISHED'];

/**
 * POST /api/video-production/[id]/update
 *
 * Body: any subset of:
 *   { prod_stage, needs_audio, video_url, audio_url, final_url,
 *     publish_url, publish_platform, prod_notes }
 *
 * Patches production fields on a video_script row. Moving to PUBLISHED stamps
 * published_at (once); moving away from PUBLISHED clears it. Every write stamps
 * prod_updated_at / prod_updated_by.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    if (body.prod_stage != null && !STAGES.includes(body.prod_stage)) {
        return NextResponse.json({ error: `prod_stage must be one of ${STAGES.join(', ')}` }, { status: 400 });
    }

    const sets = ['prod_updated_at = NOW()'];
    const vals = [];
    const addSet = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

    if (body.prod_stage != null) addSet('prod_stage', body.prod_stage);
    if (typeof body.needs_audio === 'boolean') addSet('needs_audio', body.needs_audio);
    // URL/text fields: allow clearing with '' -> NULL
    const textFields = ['video_url', 'audio_url', 'final_url', 'publish_url', 'publish_platform', 'prod_notes'];
    for (const f of textFields) {
        if (typeof body[f] === 'string') addSet(f, body[f].trim() || null);
    }

    // published_at bookkeeping keyed off the target stage
    if (body.prod_stage === 'PUBLISHED') {
        sets.push('published_at = COALESCE(published_at, NOW())');
    } else if (body.prod_stage != null && body.prod_stage !== 'PUBLISHED') {
        sets.push('published_at = NULL');
    }

    vals.push(user.id);
    sets.push(`prod_updated_by = $${vals.length}`);

    const client = await db.connect();
    try {
        vals.push(id);
        const res = await client.query(
            `UPDATE video_script SET ${sets.join(', ')}
             WHERE video_script_id = $${vals.length}
             RETURNING video_script_id, word, prod_stage, needs_audio, video_url,
                       audio_url, audio_status, final_url, publish_url, publish_platform,
                       published_at, prod_notes, prod_updated_at`,
            vals
        );
        if (res.rows.length === 0) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, row: res.rows[0] });
    } catch (e) {
        console.error('video-production/update error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
