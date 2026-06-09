import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/section-test/sections?exam_id=X
 * Lists sections in this exam with current SECTION-test-eligible pool size.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const exam_id = searchParams.get('exam_id');
    if (!exam_id) {
        return NextResponse.json({ error: 'exam_id is required' }, { status: 400 });
    }

    try {
        const sectionsRes = await db.query(`
            SELECT section_id, code, name, num_questions, sort_order
            FROM exam_section
            WHERE exam_id = $1
            ORDER BY sort_order ASC NULLS LAST, code ASC
        `, [exam_id]);

        if (sectionsRes.rows.length === 0) {
            return NextResponse.json({ sections: [] });
        }

        const sections = [];
        for (const section of sectionsRes.rows) {
            const equivRes = await db.query(`
                SELECT section_id FROM exam_section WHERE UPPER(code) = UPPER($1)
            `, [section.code]);
            const allSectionIds = equivRes.rows.map(r => r.section_id);

            const poolRes = await db.query(`
                SELECT COUNT(*) AS cnt
                FROM question_version qv
                JOIN exam_section es ON es.section_id = qv.exam_section_id
                WHERE qv.exam_section_id = ANY($1)
                  AND qv.subtype IS NOT NULL
                  AND qv.language = 'EN'
                  AND qv.solution_status = 'DONE'
                  AND qv.difficulty IS NOT NULL
                  AND qv.correct_option_label IS NOT NULL
                  AND qv.correct_option_label != ''
                  AND (es.exam_id != $2 OR qv.paper_session_id IS NULL)
                  AND EXISTS (
                      SELECT 1 FROM question_links ql
                      WHERE ql.english_question_id = qv.question_id
                         OR ql.hindi_question_id = qv.question_id
                  )
                  AND qv.question_id NOT IN (
                      SELECT question_id FROM question_usage
                      WHERE exam_id = $2 AND test_type = 'SECTION'
                  )
                  AND qv.question_id NOT IN (
                      SELECT mtq.question_id FROM mock_test_question mtq
                      JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
                      WHERE mt.exam_id = $2 AND mt.test_type = 'SECTION'
                        AND mt.status IN ('DRAFT','IN_REVIEW','APPROVED')
                  )
            `, [allSectionIds, exam_id]);

            const target = section.num_questions && section.num_questions > 0 ? section.num_questions : 25;
            const pool_size = parseInt(poolRes.rows[0].cnt, 10);

            sections.push({
                section_id: section.section_id,
                code: section.code,
                name: section.name,
                target,
                pool_size,
                tests_possible: Math.floor(pool_size / target),
            });
        }

        return NextResponse.json({ sections });
    } catch (e) {
        console.error('section-test/sections error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
