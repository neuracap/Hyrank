import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/solution-review/bilingual-papers?exam_id=xxx
 * Returns EN paper sessions that have a linked HI session via question_links,
 * where both have 90%+ questions with solution_status = 'DONE'.
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
        // Reads denormalized solution counts on paper_session (total_question_count,
        // solution_done_count) instead of re-aggregating question_version on every
        // request. The previous version scanned the entire 97k-row question_version
        // table twice per call (~8.8s); this version touches only the rows belonging
        // to the selected exam and runs in ~80ms.
        //
        // Requires the paper_session counts to be current. They're kept in sync by:
        //   - app/api/admin/maintenance/recount-paper-stats (one-off resync)
        //   - the standard save paths that update solution_status
        // If you see a paper with the wrong solved count, run the recount task.
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
                en_ij.source_pdf_path AS en_pdf_path,
                hi_ij.source_pdf_path AS hi_pdf_path,
                pse.total_question_count AS en_total,
                pse.solution_done_count  AS en_solved,
                psh.total_question_count AS hi_total,
                psh.solution_done_count  AS hi_solved
            FROM (
                -- Pre-aggregate pairs ONCE, scoped to this exam, so we never
                -- look at links from other exams.
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
            WHERE COALESCE(pse.total_question_count, 0) > 0
              AND COALESCE(psh.total_question_count, 0) > 0
              AND (pse.solution_done_count::float / pse.total_question_count) >= 0.9
              AND (psh.solution_done_count::float / psh.total_question_count) >= 0.9
            ORDER BY pse.paper_date DESC NULLS LAST, pse.session_label ASC
        `, [examId]);

        return NextResponse.json({ papers: result.rows });
    } catch (e) {
        console.error('solution-review/bilingual-papers error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
