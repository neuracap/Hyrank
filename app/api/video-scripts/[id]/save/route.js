import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const VALID_STATUS = ['GENERATED', 'EDITED', 'APPROVED'];

/**
 * POST /api/video-scripts/[id]/save
 *
 * Body: { transcript?: string, status?: 'EDITED' | 'APPROVED' | 'GENERATED' }
 *
 * Saves the reviewer's edited transcript and/or updates the status.
 * When status is EDITED/APPROVED, records reviewed_by + reviewed_at.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const hasTranscript = typeof body.transcript === 'string';
    const hasLatin = typeof body.transcript_latin === 'string';
    const status = body.status;
    if (status && !VALID_STATUS.includes(status)) {
        return NextResponse.json({ error: `status must be one of ${VALID_STATUS.join(', ')}` }, { status: 400 });
    }
    if (!hasTranscript && !hasLatin && !status) {
        return NextResponse.json({ error: 'Nothing to save (provide transcript and/or status)' }, { status: 400 });
    }

    const sets = ['updated_at = NOW()'];
    const vals = [];
    if (hasTranscript) {
        vals.push(body.transcript);
        sets.push(`transcript = $${vals.length}`);
    }
    if (hasLatin) {
        vals.push(body.transcript_latin.trim() || null);
        sets.push(`transcript_latin = $${vals.length}`);
    }
    if (status) {
        vals.push(status);
        sets.push(`status = $${vals.length}`);
    }
    // Any reviewer touch stamps who/when.
    if (status === 'EDITED' || status === 'APPROVED') {
        vals.push(user.id);
        sets.push(`reviewed_by = $${vals.length}`);
        sets.push('reviewed_at = NOW()');
    }
    // Approving a script enters it into the production pipeline (if not already there).
    if (status === 'APPROVED') {
        sets.push(`prod_stage = CASE WHEN prod_stage = 'NONE' THEN 'QUEUED' ELSE prod_stage END`);
    }

    const client = await db.connect();
    try {
        vals.push(id);
        const res = await client.query(
            `UPDATE video_script SET ${sets.join(', ')}
             WHERE video_script_id = $${vals.length}
             RETURNING video_script_id, word, status, prod_stage, transcript, transcript_latin, reviewed_at`,
            vals
        );
        if (res.rows.length === 0) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, row: res.rows[0] });
    } catch (e) {
        console.error('video-scripts/save error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
