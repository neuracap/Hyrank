import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/section-test/sections?exam_id=X&difficulty_level=L
 * Lists sections in this exam with current SECTION-test-eligible pool size
 * at the given level. Computed in a single GROUP BY query (the per-section
 * loop was timing out on prod).
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const exam_id = searchParams.get('exam_id');
    const difficulty_level = parseInt(searchParams.get('difficulty_level'), 10);
    if (!exam_id) {
        return NextResponse.json({ error: 'exam_id is required' }, { status: 400 });
    }
    if (![1, 2, 3].includes(difficulty_level)) {
        return NextResponse.json({ error: 'difficulty_level must be 1, 2 or 3' }, { status: 400 });
    }

    try {
        // 1. This exam's sections (display metadata + target size)
        const sectionsRes = await db.query(`
            SELECT section_id, code, name, num_questions, sort_order
            FROM exam_section
            WHERE exam_id = $1
            ORDER BY sort_order ASC NULLS LAST, code ASC
        `, [exam_id]);

        if (sectionsRes.rows.length === 0) {
            return NextResponse.json({ sections: [] });
        }

        const codes = sectionsRes.rows.map(s => String(s.code).toUpperCase());

        // 2. Pool size per code, single GROUP BY across all equivalent sections.
        //    Uses a CTE+JOIN against linked questions (10x faster than the
        //    EXISTS-OR check) and NOT EXISTS for the SECTION-locked exclusion.
        const poolRes = await db.query(`
            WITH linked AS (
                SELECT DISTINCT english_question_id AS qid FROM question_links
                  WHERE english_question_id IS NOT NULL
                UNION
                SELECT hindi_question_id FROM question_links
                  WHERE hindi_question_id IS NOT NULL
            )
            SELECT
                UPPER(es.code) AS code,
                COUNT(*) AS pool_size
            FROM question_version qv
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            JOIN linked l ON l.qid = qv.question_id
            WHERE UPPER(es.code) = ANY($1)
              AND qv.subtype IS NOT NULL
              AND qv.language = 'EN'
              AND qv.solution_status = 'DONE'
              AND qv.difficulty IS NOT NULL
              AND qv.correct_option_label IS NOT NULL
              AND qv.correct_option_label != ''
              AND (es.exam_id != $2 OR qv.paper_session_id IS NULL)
              AND NOT EXISTS (
                  SELECT 1 FROM question_usage qu
                  WHERE qu.question_id = qv.question_id
                    AND qu.test_type = 'SECTION'
                    AND qu.difficulty_level = $3
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM mock_test_question mtq
                  JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
                  WHERE mtq.question_id = qv.question_id
                    AND mt.test_type = 'SECTION'
                    AND mt.difficulty_level = $3
                    AND mt.status IN ('DRAFT','IN_REVIEW','APPROVED')
              )
            GROUP BY UPPER(es.code)
        `, [codes, exam_id, difficulty_level]);

        const poolByCode = Object.fromEntries(
            poolRes.rows.map(r => [r.code, parseInt(r.pool_size, 10)])
        );

        const sections = sectionsRes.rows.map(section => {
            const target = section.num_questions && section.num_questions > 0 ? section.num_questions : 25;
            const pool_size = poolByCode[String(section.code).toUpperCase()] || 0;
            return {
                section_id: section.section_id,
                code: section.code,
                name: section.name,
                target,
                pool_size,
                tests_possible: Math.floor(pool_size / target),
            };
        });

        return NextResponse.json({ sections });
    } catch (e) {
        console.error('section-test/sections error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
