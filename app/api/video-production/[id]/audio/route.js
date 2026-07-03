import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { generateSpeech, elevenLabsConfigured } from '@/lib/elevenlabs';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

/**
 * POST /api/video-production/[id]/audio
 *
 * Synthesizes the approved transcript with ElevenLabs, uploads the MP3 to
 * Cloudinary (folder video-scripts/audio), and stores the hosted URL in audio_url.
 * Voiceover text = current transcript. Sets audio_status DONE/FAILED.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!elevenLabsConfigured()) {
        return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 501 });
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
        const { word, transcript } = cur.rows[0];
        if (!transcript || !transcript.trim()) {
            return NextResponse.json({ error: 'No transcript to synthesize' }, { status: 400 });
        }

        await client.query(
            `UPDATE video_script SET audio_status = 'GENERATING', audio_error = NULL WHERE video_script_id = $1`, [id]
        );

        let mp3;
        try {
            mp3 = await generateSpeech(transcript);
        } catch (ttsErr) {
            console.error('video-production/audio — ElevenLabs error:', ttsErr);
            await client.query(
                `UPDATE video_script SET audio_status = 'FAILED', audio_error = $1 WHERE video_script_id = $2`,
                [ttsErr.message, id]
            );
            return NextResponse.json({ error: ttsErr.message }, { status: 502 });
        }

        // Upload MP3 to Cloudinary (audio uses resource_type 'video').
        const dataURI = `data:audio/mpeg;base64,${mp3.toString('base64')}`;
        const safeWord = String(word || 'word').replace(/[^a-z0-9]/gi, '-').toLowerCase();
        let secureUrl;
        try {
            const uploadResult = await cloudinary.uploader.upload(dataURI, {
                folder: 'video-scripts/audio',
                resource_type: 'video',
                public_id: `${safeWord}-${id.slice(0, 8)}`,
                overwrite: true,
            });
            secureUrl = uploadResult.secure_url;
        } catch (upErr) {
            console.error('video-production/audio — Cloudinary error:', upErr);
            await client.query(
                `UPDATE video_script SET audio_status = 'FAILED', audio_error = $1 WHERE video_script_id = $2`,
                [`Cloudinary upload failed: ${upErr.message}`, id]
            );
            return NextResponse.json({ error: `Cloudinary upload failed: ${upErr.message}` }, { status: 502 });
        }

        const res = await client.query(
            `UPDATE video_script
             SET audio_url = $1, audio_status = 'DONE', audio_error = NULL, prod_updated_at = NOW()
             WHERE video_script_id = $2
             RETURNING video_script_id, word, audio_url, audio_status`,
            [secureUrl, id]
        );
        return NextResponse.json({ success: true, row: res.rows[0] });
    } catch (e) {
        console.error('video-production/audio error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
