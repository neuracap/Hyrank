import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/mock-test/create
 * Create a new DRAFT mock test.
 * Body: { name, exam_id }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { name, exam_id, type = 'MOCK' } = body;
    if (!name || !exam_id) {
        return NextResponse.json({ error: 'name and exam_id are required' }, { status: 400 });
    }
    if (!['MOCK', 'SECTION'].includes(type)) {
        return NextResponse.json({ error: 'type must be MOCK or SECTION' }, { status: 400 });
    }

    try {
        const res = await db.query(`
            INSERT INTO mock_test (mock_test_id, exam_id, name, status, type, created_by, created_at, updated_at)
            VALUES (gen_random_uuid(), $1, $2, 'DRAFT', $3, $4, NOW(), NOW())
            RETURNING mock_test_id, name
        `, [exam_id, name, type, user.id]);

        return NextResponse.json({ success: true, mock_test: res.rows[0] });

    } catch (e) {
        if (e.code === '23505') {
            return NextResponse.json({ error: 'A mock test with this name already exists' }, { status: 409 });
        }
        console.error('mock-test/create error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
