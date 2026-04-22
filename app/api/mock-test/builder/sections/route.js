import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * GET /api/mock-test/builder/sections
 * Load exam sections + current accepted counts for a mock test.
 * Params: exam_id, mock_test_id
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const exam_id      = searchParams.get('exam_id');
    const mock_test_id = searchParams.get('mock_test_id');

    if (!exam_id) {
        return NextResponse.json({ error: 'exam_id is required' }, { status: 400 });
    }

    try {
        const sectionsRes = await db.query(`
            SELECT section_id, code, name, num_questions, sort_order
            FROM exam_section
            WHERE exam_id = $1
            ORDER BY sort_order ASC NULLS LAST
        `, [exam_id]);

        let counts = {};
        if (mock_test_id) {
            const countsRes = await db.query(`
                SELECT exam_section_id, COUNT(*) AS cnt
                FROM mock_test_question
                WHERE mock_test_id = $1
                GROUP BY exam_section_id
            `, [mock_test_id]);
            for (const r of countsRes.rows) {
                counts[r.exam_section_id] = parseInt(r.cnt);
            }
        }

        return NextResponse.json({ sections: sectionsRes.rows, counts });

    } catch (e) {
        console.error('mock-test/builder/sections error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
