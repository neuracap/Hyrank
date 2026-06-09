import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/topic-test/subtypes?exam_id=X
 * Returns subtypes carried by THIS exam's sections (plus equivalent sections
 * across other exams), so the topic-test picker can show what's selectable.
 *
 * Response: { subtypes: [{ subtype, total_count, exam_count, best_section_code }] }
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
        // Step 1: section codes that exist in this exam
        const codesRes = await db.query(`
            SELECT DISTINCT UPPER(code) AS code
            FROM exam_section
            WHERE exam_id = $1
        `, [exam_id]);
        const codes = codesRes.rows.map(r => r.code);
        if (codes.length === 0) {
            return NextResponse.json({ subtypes: [] });
        }

        // Step 2: all sections (across all exams) sharing those codes — same widening
        // rule the generator uses.
        const sectionsRes = await db.query(`
            SELECT section_id, code, exam_id
            FROM exam_section
            WHERE UPPER(code) = ANY($1)
        `, [codes]);
        const allSectionIds = sectionsRes.rows.map(s => s.section_id);

        // Step 3: subtype counts across that union, using the same eligibility rules
        // as /api/topic-test/create's pool query — and subtracting questions already
        // locked by a TOPIC test (published or DRAFT/IN_REVIEW/APPROVED).
        const res = await db.query(`
            WITH linked AS (
                SELECT DISTINCT english_question_id AS qid FROM question_links
                  WHERE english_question_id IS NOT NULL
                UNION
                SELECT hindi_question_id FROM question_links
                  WHERE hindi_question_id IS NOT NULL
            )
            SELECT qv.subtype,
                   COUNT(*) AS total_count,
                   MIN(es.code) AS best_section_code,
                   COUNT(DISTINCT es.exam_id) AS exam_count
            FROM question_version qv
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            JOIN linked l ON l.qid = qv.question_id
            WHERE qv.exam_section_id = ANY($1)
              AND qv.language = 'EN'
              AND qv.solution_status = 'DONE'
              AND qv.subtype IS NOT NULL
              AND qv.difficulty IS NOT NULL
              AND qv.correct_option_label IS NOT NULL
              AND qv.correct_option_label != ''
              AND (
                  es.exam_id != $2
                  OR qv.paper_session_id IS NULL
              )
              AND NOT EXISTS (
                  SELECT 1 FROM question_usage qu
                  WHERE qu.question_id = qv.question_id
                    AND qu.test_type = 'TOPIC'
                    AND qu.difficulty_level = $3
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM mock_test_question mtq
                  JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
                  WHERE mtq.question_id = qv.question_id
                    AND mt.test_type = 'TOPIC'
                    AND mt.difficulty_level = $3
                    AND mt.status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')
              )
            GROUP BY qv.subtype
            ORDER BY total_count DESC, qv.subtype ASC
        `, [allSectionIds, exam_id, difficulty_level]);

        return NextResponse.json({
            subtypes: res.rows.map(r => ({
                subtype: r.subtype,
                total_count: parseInt(r.total_count, 10),
                exam_count: parseInt(r.exam_count, 10),
                best_section_code: r.best_section_code,
            })),
        });
    } catch (e) {
        console.error('topic-test/subtypes error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
