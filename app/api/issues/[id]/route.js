import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

const VALID_STATUS = ['open', 'resolved', 'dismissed'];

/**
 * PATCH /api/issues/[id]
 *
 * Body: { status?: 'open'|'resolved'|'dismissed', resolution_notes?: string }
 *
 * Sets resolved_at = NOW() when moving away from 'open', clears it when
 * moving back to 'open'. resolution_notes is optional and may be sent
 * with or without a status change.
 */
export async function PATCH(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { status, resolution_notes } = body || {};

    if (status != null && !VALID_STATUS.includes(status)) {
        return NextResponse.json({ error: `status must be one of ${VALID_STATUS.join(', ')}` }, { status: 400 });
    }
    if (resolution_notes != null && typeof resolution_notes !== 'string') {
        return NextResponse.json({ error: 'resolution_notes must be a string' }, { status: 400 });
    }
    if (status == null && resolution_notes == null) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const sets = [];
    const args = [];
    if (status != null) {
        args.push(status);
        sets.push(`status = $${args.length}`);
        if (status === 'open') {
            sets.push(`resolved_at = NULL`);
        } else {
            sets.push(`resolved_at = NOW()`);
        }
    }
    if (resolution_notes != null) {
        args.push(resolution_notes);
        sets.push(`resolution_notes = $${args.length}`);
    }
    args.push(id);

    try {
        const res = await db.query(
            `UPDATE question_issue_reports
             SET ${sets.join(', ')}
             WHERE id = $${args.length}
             RETURNING id, status, resolved_at, resolution_notes`,
            args
        );
        if (res.rows.length === 0) {
            return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, issue: res.rows[0] });
    } catch (e) {
        console.error('issues/[id] PATCH error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
