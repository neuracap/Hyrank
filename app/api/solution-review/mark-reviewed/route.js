import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export async function POST(request) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { paper_session_id } = body;
    if (!paper_session_id) {
        return NextResponse.json({ error: 'paper_session_id is required' }, { status: 400 });
    }

    try {
        const result = await db.query(`
            UPDATE paper_session
            SET status = 'SOLUTION_REVIEW', updated_at = NOW()
            WHERE paper_session_id = $1
            RETURNING paper_session_id, status
        `, [paper_session_id]);

        if (result.rowCount === 0) {
            return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, new_status: 'SOLUTION_REVIEW' });
    } catch (e) {
        console.error('Solution review mark-reviewed error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
