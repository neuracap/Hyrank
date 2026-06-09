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
    if (!exam_id) {
        return NextResponse.json({ error: 'exam_id is required' }, { status: 400 });
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
            SELECT qv.subtype,
                   COUNT(*) AS total_count,
                   MIN(es.code) AS best_section_code,
                   COUNT(DISTINCT es.exam_id) AS exam_count
            FROM question_version qv
            JOIN exam_section es ON es.section_id = qv.exam_section_id
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
              AND EXISTS (
                  SELECT 1 FROM question_links ql
                  WHERE ql.english_question_id = qv.question_id
                     OR ql.hindi_question_id = qv.question_id
              )
              AND qv.question_id NOT IN (
                  SELECT question_id FROM question_usage
                  WHERE exam_id = $2 AND test_type = 'TOPIC'
              )
              AND qv.question_id NOT IN (
                  SELECT mtq.question_id
                  FROM mock_test_question mtq
                  JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
                  WHERE mt.exam_id = $2
                    AND mt.test_type = 'TOPIC'
                    AND mt.status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')
              )
            GROUP BY qv.subtype
            ORDER BY total_count DESC, qv.subtype ASC
        `, [allSectionIds, exam_id]);

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
