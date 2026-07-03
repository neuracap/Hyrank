import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { elevenLabsConfigured, ELEVEN_VOICES } from '@/lib/elevenlabs';

export const dynamic = 'force-dynamic';

/**
 * GET /api/video-scripts/list
 *
 * Query params (all optional):
 *   status:  GENERATED | EDITED | APPROVED | FAILED
 *   search:  substring match on word or transcript
 *   limit:   int (default 100, max 500)
 *   offset:  int (default 0)
 *
 * Returns the list plus counts_by_status for the filter tabs.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const search = (searchParams.get('search') || '').trim();
    const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') || '100', 10) || 100));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);

    const conditions = ['1=1'];
    const params = [];
    if (status) {
        params.push(status);
        conditions.push(`status = $${params.length}`);
    }
    if (search) {
        params.push(`%${search}%`);
        conditions.push(`(word ILIKE $${params.length} OR transcript ILIKE $${params.length})`);
    }
    const where = conditions.join(' AND ');

    const client = await db.connect();
    try {
        const totalRes = await client.query(
            `SELECT COUNT(*)::int AS c FROM video_script WHERE ${where}`, params
        );
        params.push(limit, offset);
        const listRes = await client.query(`
            SELECT video_script_id, word, word_sno, raw_transcript, transcript,
                   model, status, gen_error, reviewed_by, reviewed_at,
                   prod_stage, needs_audio, video_url, audio_url, audio_status,
                   audio_error, audio_voice, final_url,
                   created_at, updated_at
            FROM video_script
            WHERE ${where}
            ORDER BY word_sno NULLS LAST, word
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        const countsRes = await client.query(
            `SELECT status, COUNT(*)::int AS c FROM video_script GROUP BY status`
        );
        const counts_by_status = {};
        for (const row of countsRes.rows) counts_by_status[row.status || 'UNKNOWN'] = row.c;

        return NextResponse.json({
            success: true,
            total: totalRes.rows[0].c,
            rows: listRes.rows,
            counts_by_status,
            elevenlabs_enabled: elevenLabsConfigured(),
            voices: ELEVEN_VOICES.map(v => ({ key: v.key, label: v.label })),
        });
    } catch (e) {
        console.error('video-scripts/list error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
