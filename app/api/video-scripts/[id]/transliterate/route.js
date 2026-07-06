import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { transliterateToLatin } from '@/lib/video-script';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/video-scripts/[id]/transliterate
 *
 * Generates (or regenerates) transcript_latin — the romanized Hinglish copy of
 * the current transcript — via Gemini. Used as the NotebookLM video source
 * because NotebookLM's burned-in captions can't render Devanagari.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;

    const client = await db.connect();
    try {
        const cur = await client.query(
            `SELECT word, transcript FROM video_script WHERE video_script_id = $1`, [id]
        );
        if (cur.rows.length === 0) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const { transcript } = cur.rows[0];
        if (!transcript || !transcript.trim()) {
            return NextResponse.json({ error: 'No transcript to transliterate' }, { status: 400 });
        }

        let latin;
        try {
            latin = await transliterateToLatin(transcript);
        } catch (genErr) {
            console.error('video-scripts/transliterate — Gemini error:', genErr);
            return NextResponse.json({ error: genErr.message }, { status: 502 });
        }

        const res = await client.query(
            `UPDATE video_script SET transcript_latin = $1, updated_at = NOW()
             WHERE video_script_id = $2
             RETURNING video_script_id, word, transcript_latin`,
            [latin, id]
        );
        return NextResponse.json({ success: true, row: res.rows[0] });
    } catch (e) {
        console.error('video-scripts/transliterate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
