import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/answer-conflicts/stats
 * Progress overview for the EN answer-key conflict queue.
 * Returns overall totals plus per-section and per-pdf_source breakdowns,
 * each split into resolved / needs_expert / pending.
 */
export async function GET() {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const baseWhere = `
        qv.language = 'EN'
        AND qv.correct_option_label IS NOT NULL
        AND qv.pdf_correct_option_label IS NOT NULL
        AND qv.correct_option_label <> qv.pdf_correct_option_label
    `;

    const client = await db.connect();
    try {
        const overall = await client.query(`
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE qv.final_correct_option_label IS NOT NULL)::int AS resolved,
                COUNT(*) FILTER (WHERE qv.final_answer_source = 'needs_expert')::int   AS needs_expert,
                COUNT(*) FILTER (WHERE qv.final_answer_source IS NULL)::int            AS pending
            FROM question_version qv
            WHERE ${baseWhere}
        `);

        const bySection = await client.query(`
            SELECT
                es.code AS section_code,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE qv.final_correct_option_label IS NOT NULL)::int AS resolved,
                COUNT(*) FILTER (WHERE qv.final_answer_source = 'needs_expert')::int   AS needs_expert,
                COUNT(*) FILTER (WHERE qv.final_answer_source IS NULL)::int            AS pending
            FROM question_version qv
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE ${baseWhere}
            GROUP BY es.code
            ORDER BY es.code
        `);

        const bySource = await client.query(`
            SELECT
                qv.pdf_verification_status AS pdf_source,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE qv.final_correct_option_label IS NOT NULL)::int AS resolved,
                COUNT(*) FILTER (WHERE qv.final_answer_source = 'needs_expert')::int   AS needs_expert,
                COUNT(*) FILTER (WHERE qv.final_answer_source IS NULL)::int            AS pending
            FROM question_version qv
            WHERE ${baseWhere}
            GROUP BY qv.pdf_verification_status
            ORDER BY
                CASE qv.pdf_verification_status
                    WHEN 'manual_verified_correct' THEN 0
                    WHEN 'auto_text_match' THEN 1
                    WHEN 'auto_resolved' THEN 2
                    ELSE 3
                END
        `);

        return NextResponse.json({
            success: true,
            overall: overall.rows[0],
            by_section: bySection.rows,
            by_source: bySource.rows,
        });
    } catch (e) {
        console.error('answer-conflicts stats error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
