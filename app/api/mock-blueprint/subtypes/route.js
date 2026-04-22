import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mock-blueprint/subtypes?section_id=xxx
 * Return distinct subtypes that appear in the given exam section
 * (from the target exam's own historical papers). Used by the blueprint
 * editor to show relevant subtypes per section.
 *
 * Falls back to exam_id-wide pool if section_id is omitted.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const section_id = searchParams.get('section_id');
    const exam_id    = searchParams.get('exam_id');

    try {
        let res;

        if (section_id) {
            // Subtypes from the target exam's own historical papers for this section
            res = await db.query(`
                SELECT qv.subtype, COUNT(*) AS cnt
                FROM question_version qv
                WHERE qv.language = 'EN'
                  AND qv.status = 'MANUALLY_CORRECTED'
                  AND qv.subtype IS NOT NULL
                  AND qv.exam_section_id = $1
                GROUP BY qv.subtype
                ORDER BY cnt DESC, qv.subtype ASC
            `, [section_id]);
        } else {
            // Fallback: all subtypes from other exams
            const params = exam_id ? [exam_id] : [];
            const excludeClause = exam_id ? `AND ps.exam_id != $1` : '';
            res = await db.query(`
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
        }

        return NextResponse.json({ subtypes: res.rows });
    } catch (e) {
        console.error('mock-blueprint/subtypes error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
