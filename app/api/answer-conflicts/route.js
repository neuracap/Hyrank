import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/answer-conflicts
 * Lists EN answer-key conflicts (solution_answer != answer_key_answer).
 *
 * Query params:
 *   section   - exam_section.code filter (e.g. REASONING, QUANT, ENGLISH, GA) or 'ALL'
 *   pdf_source- pdf_verification_status filter or 'ALL'
 *   view      - 'pending' (default) | 'resolved' | 'needs_expert' | 'all'
 *   page      - 1-based page (default 1)
 *   limit     - page size (default 50, max 200)
 *
 * Ordering: priority bucket (manual_verified_correct < auto_text_match < auto_resolved),
 *           then section, paper_date, question_number.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const section = searchParams.get('section') || 'ALL';
    const pdfSource = searchParams.get('pdf_source') || 'ALL';
    const view = searchParams.get('view') || 'pending';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    const conditions = [
        `qv.language = 'EN'`,
        `qv.correct_option_label IS NOT NULL`,
        `qv.pdf_correct_option_label IS NOT NULL`,
        `qv.correct_option_label <> qv.pdf_correct_option_label`,
    ];
    const params = [];
    let p = 1;

    if (section !== 'ALL') {
        conditions.push(`es.code = $${p++}`);
        params.push(section);
    }
    if (pdfSource !== 'ALL') {
        conditions.push(`qv.pdf_verification_status = $${p++}`);
        params.push(pdfSource);
    }
    if (view === 'pending') {
        conditions.push(`qv.final_answer_source IS NULL`);
    } else if (view === 'resolved') {
        conditions.push(`qv.final_correct_option_label IS NOT NULL`);
    } else if (view === 'needs_expert') {
        conditions.push(`qv.final_answer_source = 'needs_expert'`);
    }
    // view === 'all' adds nothing

    const whereClause = conditions.join(' AND ');

    const client = await db.connect();
    try {
        const countRes = await client.query(`
            SELECT COUNT(*)::int AS c
            FROM question_version qv
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE ${whereClause}
        `, params);
        const total = countRes.rows[0].c;

        const listParams = [...params, limit, offset];
        const rowsRes = await client.query(`
            SELECT
                qv.question_id,
                qv.version_no,
                qv.paper_session_id,
                e.code  AS exam_code,
                ps.paper_date,
                ps.shift_label,
                ps.tier,
                es.code AS section_code,
                qv.question_number_int AS question_number,
                qv.source_question_no,
                qv.correct_option_label     AS solution_answer,
                qv.pdf_correct_option_label AS answer_key_answer,
                qv.pdf_verification_status  AS pdf_source,
                (
                    SELECT array_agg(qo.option_key ORDER BY qo.option_key)
                    FROM question_option qo
                    WHERE qo.question_id = qv.question_id
                      AND qo.version_no  = qv.version_no
                      AND qo.language    = 'EN'
                      AND qo.is_correct  = true
                ) AS option_flag_answers,
                qv.body_json     AS question_stem,
                qv.solution_json AS solution_text,
                qv.solution_status,
                qv.final_correct_option_label,
                qv.final_answer_source,
                qv.final_resolved_at,
                (
                    SELECT jsonb_object_agg(qo.option_key, qo.option_json ORDER BY qo.option_key)
                    FROM question_option qo
                    WHERE qo.question_id = qv.question_id
                      AND qo.version_no  = qv.version_no
                      AND qo.language    = 'EN'
                ) AS options,
                j.source_pdf_path
            FROM question_version qv
            JOIN exam_section  es ON es.section_id = qv.exam_section_id
            JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            LEFT JOIN exam        e ON e.exam_id = ps.exam_id
            LEFT JOIN raw_mmd_doc d ON d.raw_mmd_doc_id = ps.raw_mmd_doc_id
            LEFT JOIN import_job  j ON j.import_job_id  = d.import_job_id
            WHERE ${whereClause}
            ORDER BY
                CASE qv.pdf_verification_status
                    WHEN 'manual_verified_correct' THEN 0
                    WHEN 'auto_text_match' THEN 1
                    WHEN 'auto_resolved' THEN 2
                    ELSE 3
                END,
                es.code,
                ps.paper_date,
                qv.question_number_int NULLS LAST
            LIMIT $${p} OFFSET $${p + 1}
        `, listParams);

        return NextResponse.json({
            success: true,
            total,
            page,
            limit,
            rows: rowsRes.rows,
        });
    } catch (e) {
        console.error('answer-conflicts list error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
