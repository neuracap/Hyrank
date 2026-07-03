import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { generateVideoScript, VIDEO_SCRIPT_MODEL } from '@/lib/video-script';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/video-scripts/[id]/generate
 *
 * Re-runs Gemini for a single row (the "Regenerate" button in the reviewer UI).
 * Overwrites raw_transcript + transcript, resets status to GENERATED, clears the
 * previous review stamp. On failure, marks the row FAILED with the error.
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
            `SELECT word FROM video_script WHERE video_script_id = $1`, [id]
        );
        if (cur.rows.length === 0) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const word = cur.rows[0].word;

        let transcript;
        try {
            transcript = await generateVideoScript(word);
        } catch (genErr) {
            console.error('video-scripts/generate — Gemini error:', genErr);
            await client.query(
                `UPDATE video_script
                 SET status = 'FAILED', gen_error = $1, model = $2, updated_at = NOW()
                 WHERE video_script_id = $3`,
                [genErr.message, VIDEO_SCRIPT_MODEL, id]
            );
            return NextResponse.json({ error: genErr.message }, { status: 502 });
        }

        const res = await client.query(
            `UPDATE video_script
             SET raw_transcript = $1, transcript = $1, model = $2,
                 status = 'GENERATED', gen_error = NULL,
                 reviewed_by = NULL, reviewed_at = NULL, updated_at = NOW()
             WHERE video_script_id = $3
             RETURNING video_script_id, word, transcript, status, model`,
            [transcript, VIDEO_SCRIPT_MODEL, id]
        );
        return NextResponse.json({ success: true, row: res.rows[0] });
    } catch (e) {
        console.error('video-scripts/generate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
