import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mock-blueprint/subtypes?exam_id=xxx
 * Return distinct subtypes available in the question pool from OTHER exams.
 * Used by the blueprint editor to populate subtype autocomplete.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const exam_id = searchParams.get('exam_id');

    try {
        const params = exam_id ? [exam_id] : [];
        const excludeClause = exam_id ? `AND ps.exam_id != $1` : '';

        const res = await db.query(`
            SELECT qv.subtype, COUNT(*) AS cnt
            FROM question_version qv
            JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            WHERE qv.language = 'EN'
              AND qv.status = 'MANUALLY_CORRECTED'
              AND qv.subtype IS NOT NULL
              ${excludeClause}
            GROUP BY qv.subtype
            ORDER BY qv.subtype ASC
        `, params);

        return NextResponse.json({ subtypes: res.rows });
    } catch (e) {
        console.error('mock-blueprint/subtypes error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
