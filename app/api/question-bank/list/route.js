import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/question-bank/list
 *   ?exam_id=<uuid>            (optional)
 *   &section_id=<uuid>         (optional)
 *   &language=EN|HI            (default EN)
 *   &source=bank|pyq|all       (default bank — questions with source_type='bank')
 *   &difficulty=1|2|3          (optional)
 *   &subtype=<text>            (optional, exact match on qv.subtype)
 *   &has_solution=true|false   (optional)
 *   &q=<search text>           (optional, ILIKE match on body text)
 *   &page=<n>                  (default 1)
 *   &page_size=<n>             (default 25, max 100)
 *
 * Returns the latest version_no per question (per language) so callers
 * always see the row that other pages would render.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const examId    = searchParams.get('exam_id');
    const sectionId = searchParams.get('section_id');
    const language  = (searchParams.get('language') || 'EN').toUpperCase();
    const difficulty = searchParams.get('difficulty');
    const subtype   = searchParams.get('subtype');
    const hasSol    = searchParams.get('has_solution');
    const source    = (searchParams.get('source') || 'bank').toLowerCase();
    const qText     = (searchParams.get('q') || '').trim();
    const page      = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize  = Math.min(Math.max(1, parseInt(searchParams.get('page_size') || '25', 10)), 100);
    const offset    = (page - 1) * pageSize;

    if (!['EN', 'HI'].includes(language)) {
        return NextResponse.json({ error: 'language must be EN or HI' }, { status: 400 });
    }

    const conditions = [
        `qv.language = $1`,
        // Latest version_no per (question_id, language) — keeps the result
        // in sync with what review / edit pages render.
        `qv.version_no = (SELECT MAX(version_no) FROM question_version
                          WHERE question_id = qv.question_id AND language = qv.language)`,
    ];
    const params = [language];
    let idx = 2;

    if (source === 'bank') {
        conditions.push(`qv.source_type = 'bank'`);
    } else if (source === 'pyq') {
        // PYQ rows live under a paper_session (i.e. were ingested from an
        // exam paper PDF, not the bank generator).
        conditions.push(`qv.paper_session_id IS NOT NULL AND qv.source_type IS DISTINCT FROM 'bank'`);
    }
    // source = 'all' → no extra filter

    if (examId) {
        conditions.push(`es.exam_id = $${idx}`);
        params.push(examId);
        idx++;
    }
    if (sectionId) {
        conditions.push(`qv.exam_section_id = $${idx}`);
        params.push(sectionId);
        idx++;
    }
    if (difficulty && ['1', '2', '3'].includes(difficulty)) {
        conditions.push(`qv.difficulty = $${idx}`);
        params.push(parseInt(difficulty, 10));
        idx++;
    }
    if (subtype) {
        conditions.push(`qv.subtype = $${idx}`);
        params.push(subtype);
        idx++;
    }
    if (hasSol === 'true') {
        conditions.push(`qv.solution_status = 'DONE'`);
    } else if (hasSol === 'false') {
        conditions.push(`qv.solution_status IS DISTINCT FROM 'DONE'`);
    }
    if (qText) {
        conditions.push(`qv.body_json->>'text' ILIKE $${idx}`);
        params.push(`%${qText}%`);
        idx++;
    }

    const whereClause = conditions.join(' AND ');

    try {
        // Count first (re-uses the same WHERE, no LIMIT/OFFSET params).
        const countRes = await db.query(`
            SELECT COUNT(*)::int AS c
            FROM question_version qv
            LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE ${whereClause}
        `, params);
        const total = countRes.rows[0].c;

        // Page of rows.
        const listParams = [...params, pageSize, offset];
        const listRes = await db.query(`
            SELECT
                qv.question_id,
                qv.version_no,
                qv.language,
                qv.body_json->>'text'         AS text,
                qv.correct_option_label       AS correct,
                qv.difficulty,
                qv.subtype,
                qv.solution_status,
                qv.solution_json,
                qv.has_image,
                qv.source_type,
                qv.final_answer_text,
                qv.paper_session_id,
                qv.solution_figure_helpful    AS figure_helpful,
                qv.solution_figure_prompt     AS figure_prompt,
                qv.created_at,
                qv.updated_at,
                es.code  AS section_code,
                es.name  AS section_name,
                e.name   AS exam_name,
                ps.session_label              AS paper_label
            FROM question_version qv
            LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
            LEFT JOIN exam e          ON e.exam_id     = es.exam_id
            LEFT JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            WHERE ${whereClause}
            ORDER BY qv.updated_at DESC NULLS LAST, qv.created_at DESC NULLS LAST
            LIMIT $${idx} OFFSET $${idx + 1}
        `, listParams);

        const rows = listRes.rows;

        // Pull options for this page only.
        const qids = rows.map(r => r.question_id);
        const optsByQ = {};
        if (qids.length > 0) {
            const optRes = await db.query(`
                SELECT question_id, option_key,
                       option_json->>'text' AS opt_text,
                       is_correct
                FROM question_option
                WHERE language = $1 AND question_id = ANY($2)
                ORDER BY option_key ASC
            `, [language, qids]);
            for (const o of optRes.rows) {
                if (!optsByQ[o.question_id]) optsByQ[o.question_id] = [];
                optsByQ[o.question_id].push(o);
            }
        }

        const questions = rows.map(r => ({
            ...r,
            options: optsByQ[r.question_id] || [],
        }));

        return NextResponse.json({
            questions,
            total,
            page,
            page_size: pageSize,
            has_more: offset + questions.length < total,
        });
    } catch (e) {
        console.error('question-bank/list error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
