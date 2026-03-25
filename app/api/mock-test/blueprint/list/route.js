import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mock-test/blueprint/list?exam_id=xxx
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const examId = searchParams.get('exam_id');

    try {
        let sql = `
            SELECT b.blueprint_id, b.exam_id, b.name, b.is_active,
                   b.config_json, b.created_at, b.updated_at,
                   e.name AS exam_name
            FROM mock_blueprint b
            LEFT JOIN exam e ON e.exam_id = b.exam_id
            WHERE b.is_active = true
        `;
        const params = [];

        if (examId) {
            params.push(examId);
            sql += ` AND b.exam_id = $${params.length}`;
        }

        sql += ` ORDER BY b.updated_at DESC`;

        const result = await db.query(sql, params);
        return NextResponse.json({ blueprints: result.rows });
    } catch (e) {
        console.error('mock-test/blueprint/list error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
