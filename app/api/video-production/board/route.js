import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { elevenLabsConfigured, ELEVEN_VOICES } from '@/lib/elevenlabs';

export const dynamic = 'force-dynamic';

const STAGES = ['QUEUED', 'VIDEO', 'EDIT', 'READY', 'PUBLISHED'];

/**
 * GET /api/video-production/board
 *
 * Query params (all optional):
 *   stage:  QUEUED | VIDEO | EDIT | READY | PUBLISHED  (default QUEUED)
 *   search: substring match on word or transcript
 *   limit:  int (default 100, max 500)
 *   offset: int (default 0)
 *
 * Returns the cards in one stage plus counts_by_stage for the column tabs.
 * Only items whose prod_stage != 'NONE' (i.e. an approved script) are on the board.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    let stage = (searchParams.get('stage') || 'QUEUED').toUpperCase();
    if (!STAGES.includes(stage)) stage = 'QUEUED';
    const search = (searchParams.get('search') || '').trim();
    const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') || '100', 10) || 100));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);

    const conditions = ['prod_stage = $1'];
    const params = [stage];
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
            SELECT video_script_id, word, word_sno, transcript,
                   prod_stage, needs_audio, video_url, audio_url, audio_status, audio_error,
                   final_url, publish_url, publish_platform, published_at,
                   prod_notes, prod_updated_at, updated_at
            FROM video_script
            WHERE ${where}
            ORDER BY prod_updated_at DESC NULLS LAST, word_sno NULLS LAST, word
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        const countsRes = await client.query(
            `SELECT prod_stage, COUNT(*)::int AS c
             FROM video_script WHERE prod_stage <> 'NONE'
             GROUP BY prod_stage`
        );
        const counts_by_stage = {};
        for (const s of STAGES) counts_by_stage[s] = 0;
        for (const row of countsRes.rows) counts_by_stage[row.prod_stage] = row.c;

        return NextResponse.json({
            success: true,
            stage,
            total: totalRes.rows[0].c,
            rows: listRes.rows,
            counts_by_stage,
            elevenlabs_enabled: elevenLabsConfigured(),
            voices: ELEVEN_VOICES.map(v => ({ key: v.key, label: v.label })),
        });
    } catch (e) {
        console.error('video-production/board error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
