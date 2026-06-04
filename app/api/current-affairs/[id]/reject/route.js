import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/current-affairs/[id]/reject
 * Body: { reason?: string }
 * Only allowed while status='NEW'.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const reason = (body.reason || '').trim() || null;

    const client = await db.connect();
    try {
        const r = await client.query(
            `UPDATE current_affairs
             SET status='REJECTED', rejection_reason=$1
             WHERE id=$2 AND status='NEW'
             RETURNING id`,
            [reason, id]
        );
        if (r.rows.length === 0) {
            return NextResponse.json({ error: 'Not found or not in NEW status' }, { status: 409 });
        }
        return NextResponse.json({ success: true });
    } catch (e) {
        console.error('current-affairs/reject error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
