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
        const result = await db.query(`
            WITH paper_pairs AS (
                SELECT DISTINCT
                    ql.paper_session_id_english AS en_session_id,
                    ql.paper_session_id_hindi AS hi_session_id
                FROM question_links ql
                WHERE ql.paper_session_id_english IS NOT NULL
                  AND ql.paper_session_id_hindi IS NOT NULL
            ),
            en_stats AS (
                SELECT
                    qv.paper_session_id,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE qv.solution_status = 'DONE') AS solved
                FROM question_version qv
                WHERE qv.language = 'EN'
                GROUP BY qv.paper_session_id
            ),
            hi_stats AS (
                SELECT
                    qv.paper_session_id,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE qv.solution_status = 'DONE') AS solved
                FROM question_version qv
                WHERE qv.language = 'HI'
                GROUP BY qv.paper_session_id
            )
            SELECT
                pp.en_session_id,
                pp.hi_session_id,
                pse.session_label AS en_label,
                psh.session_label AS hi_label,
                pse.paper_date,
                pse.subject,
                pse.status AS en_status,
                (SELECT ij.source_pdf_path FROM raw_mmd_doc d JOIN import_job ij ON d.import_job_id = ij.import_job_id WHERE d.raw_mmd_doc_id = pse.raw_mmd_doc_id LIMIT 1) AS en_pdf_path,
                (SELECT ij.source_pdf_path FROM raw_mmd_doc d JOIN import_job ij ON d.import_job_id = ij.import_job_id WHERE d.raw_mmd_doc_id = psh.raw_mmd_doc_id LIMIT 1) AS hi_pdf_path,
                en_s.total AS en_total,
                en_s.solved AS en_solved,
                hi_s.total AS hi_total,
                hi_s.solved AS hi_solved,
                (SELECT COUNT(*) FROM question_links ql2
                 WHERE ql2.paper_session_id_english = pp.en_session_id
                   AND ql2.paper_session_id_hindi = pp.hi_session_id) AS linked_count
            FROM paper_pairs pp
            JOIN paper_session pse ON pse.paper_session_id = pp.en_session_id
            JOIN paper_session psh ON psh.paper_session_id = pp.hi_session_id
            LEFT JOIN en_stats en_s ON en_s.paper_session_id = pp.en_session_id
            LEFT JOIN hi_stats hi_s ON hi_s.paper_session_id = pp.hi_session_id
            WHERE pse.exam_id = $1
              AND en_s.total > 0
              AND hi_s.total > 0
              AND (en_s.solved::float / en_s.total) >= 0.9
              AND (hi_s.solved::float / hi_s.total) >= 0.9
            ORDER BY pse.paper_date DESC NULLS LAST, pse.session_label ASC
        `, [examId]);

        return NextResponse.json({ papers: result.rows });
    } catch (e) {
        console.error('solution-review/bilingual-papers error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
