import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { canAccessSolutionReview } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/solution-review/production-bilingual-papers?exam_id=xxx
 * Returns EN+HI paper pairs where BOTH sessions have status = 'PRODUCTION'.
 * Used by /review-production-bilingual to surface live tests for review.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!canAccessSolutionReview(user)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const examId = searchParams.get('exam_id');
    if (!examId) {
        return NextResponse.json({ error: 'exam_id is required' }, { status: 400 });
    }

    try {
        const result = await db.query(`
            SELECT
                pp.en_session_id,
                pp.hi_session_id,
                pp.linked_count,
                pse.session_label AS en_label,
                psh.session_label AS hi_label,
                pse.paper_date,
                pse.subject,
                pse.status AS en_status,
                psh.status AS hi_status,
                en_ij.source_pdf_path AS en_pdf_path,
                hi_ij.source_pdf_path AS hi_pdf_path,
                pse.total_question_count AS en_total,
                pse.solution_done_count  AS en_solved,
                psh.total_question_count AS hi_total,
                psh.solution_done_count  AS hi_solved
            FROM (
                SELECT ql.paper_session_id_english AS en_session_id,
                       ql.paper_session_id_hindi   AS hi_session_id,
                       COUNT(*)::int AS linked_count
                FROM question_links ql
                JOIN paper_session ps_filter
                  ON ps_filter.paper_session_id = ql.paper_session_id_english
                 AND ps_filter.exam_id = $1
                WHERE ql.paper_session_id_hindi IS NOT NULL
                GROUP BY ql.paper_session_id_english, ql.paper_session_id_hindi
            ) pp
            JOIN paper_session pse ON pse.paper_session_id = pp.en_session_id
            JOIN paper_session psh ON psh.paper_session_id = pp.hi_session_id
            LEFT JOIN raw_mmd_doc en_doc ON en_doc.raw_mmd_doc_id = pse.raw_mmd_doc_id
            LEFT JOIN import_job en_ij  ON en_ij.import_job_id   = en_doc.import_job_id
            LEFT JOIN raw_mmd_doc hi_doc ON hi_doc.raw_mmd_doc_id = psh.raw_mmd_doc_id
            LEFT JOIN import_job hi_ij  ON hi_ij.import_job_id   = hi_doc.import_job_id
            WHERE pse.status = 'PRODUCTION'
              AND psh.status = 'PRODUCTION'
            ORDER BY pse.paper_date DESC NULLS LAST, pse.session_label ASC
        `, [examId]);

        return NextResponse.json({ papers: result.rows });
    } catch (e) {
        console.error('solution-review/production-bilingual-papers error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
