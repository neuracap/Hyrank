import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cgl-mock/[id]/rename
 * Body: { name: string }
 * Updates mock_test.name in place. Trims, enforces 1-200 chars.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const name = (body?.name || '').trim();
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (name.length > 200) return NextResponse.json({ error: 'name must be ≤ 200 chars' }, { status: 400 });

    const client = await db.connect();
    try {
        const res = await client.query(
            `UPDATE mock_test SET name = $1, updated_at = NOW()
             WHERE mock_test_id = $2
             RETURNING mock_test_id, name`,
            [name, mockTestId]
        );
        if (res.rows.length === 0) {
            return NextResponse.json({ error: 'Mock not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, mock_test_id: res.rows[0].mock_test_id, name: res.rows[0].name });
    } catch (e) {
        console.error('cgl-mock/rename error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
