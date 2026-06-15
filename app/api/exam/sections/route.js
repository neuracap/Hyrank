import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/exam/sections?exam_id=...
 * Lightweight section list for an exam, used by inline editors that need
 * a section dropdown.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const examId = searchParams.get('exam_id');
    if (!examId) {
        return NextResponse.json({ error: 'exam_id is required' }, { status: 400 });
    }
    try {
        const res = await db.query(`
            SELECT section_id, code, name, sort_order
            FROM exam_section
            WHERE exam_id = $1
            ORDER BY sort_order ASC NULLS LAST, code ASC
        `, [examId]);
        return NextResponse.json({ sections: res.rows });
    } catch (e) {
        console.error('exam/sections error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
