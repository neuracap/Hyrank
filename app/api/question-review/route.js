import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const user = await getCurrentUser();

    if (!user || !user.isAdmin) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const questionId = searchParams.get('questionId');

    if (!questionId) {
        return Response.json({ error: 'Missing questionId parameter' }, { status: 400 });
    }

    const client = await db.connect();

    try {
        const query = `
            SELECT
                ql.english_question_id,
                ql.hindi_question_id,

                en.paper_session_id      AS english_paper_session_id,
                en.language              AS english_language,
                en.question_number_int   AS english_qno,
                en.body_json->>'text'    AS english_question_stem,
                en.correct_option_label  AS english_correct,
                en.difficulty            AS english_difficulty,
                en.subtype               AS english_subtype,
                en.solution_status       AS english_solution_status,
                en.solution_json         AS english_solution_json,

                hi.paper_session_id      AS hindi_paper_session_id,
                hi.language              AS hindi_language,
                hi.question_number_int   AS hindi_qno,
                hi.body_json->>'text'    AS hindi_question_stem,
                hi.correct_option_label  AS hindi_correct,
                hi.difficulty            AS hindi_difficulty,
                hi.solution_status       AS hindi_solution_status,
                hi.solution_json         AS hindi_solution_json,

                -- English options (key -> text), ordered by option_key
                (
                    SELECT jsonb_object_agg(eo.option_key, eo.option_json->>'text' ORDER BY eo.option_key)
                    FROM public.question_option eo
                    WHERE eo.question_id = ql.english_question_id
                    AND eo.version_no  = ql.english_version_no
                    AND eo.language    = ql.english_language
                ) AS english_options,

                -- Hindi options (key -> text), ordered by option_key
                (
                    SELECT jsonb_object_agg(ho.option_key, ho.option_json->>'text' ORDER BY ho.option_key)
                    FROM public.question_option ho
                    WHERE ho.question_id = ql.hindi_question_id
                    AND ho.version_no  = ql.hindi_version_no
                    AND ho.language    = ql.hindi_language
                ) AS hindi_options,

                -- Paper details (English)
                pe.session_label AS english_session_label,
                pe.paper_date AS english_paper_date,
                pe.shift_label AS english_shift_label,
                pe.language AS english_paper_language,
                ee.name AS english_exam_name,
                en.source_question_no AS english_source_qno,
                ese.code AS english_section_code,
                je.source_pdf_path AS english_pdf_path,

                -- Paper details (Hindi)
                ph.session_label AS hindi_session_label,
                ph.paper_date AS hindi_paper_date,
                ph.shift_label AS hindi_shift_label,
                ph.language AS hindi_paper_language,
                eh.name AS hindi_exam_name,
                hi.source_question_no AS hindi_source_qno,
                esh.code AS hindi_section_code,
                jh.source_pdf_path AS hindi_pdf_path

            FROM public.question_links ql
            JOIN public.question_version en
                ON en.question_id = ql.english_question_id
               AND en.version_no  = ql.english_version_no
               AND en.language    = ql.english_language
            JOIN public.question_version hi
                ON hi.question_id = ql.hindi_question_id
               AND hi.version_no  = ql.hindi_version_no
               AND hi.language    = ql.hindi_language
            LEFT JOIN paper_session pe ON en.paper_session_id = pe.paper_session_id
            LEFT JOIN exam ee ON pe.exam_id = ee.exam_id
            LEFT JOIN exam_section ese ON en.exam_section_id = ese.section_id
            LEFT JOIN raw_mmd_doc de ON pe.raw_mmd_doc_id = de.raw_mmd_doc_id
            LEFT JOIN import_job  je ON de.import_job_id   = je.import_job_id
            LEFT JOIN paper_session ph ON hi.paper_session_id = ph.paper_session_id
            LEFT JOIN exam eh ON ph.exam_id = eh.exam_id
            LEFT JOIN exam_section esh ON hi.exam_section_id = esh.section_id
            LEFT JOIN raw_mmd_doc dh ON ph.raw_mmd_doc_id = dh.raw_mmd_doc_id
            LEFT JOIN import_job  jh ON dh.import_job_id   = jh.import_job_id
            WHERE ql.english_question_id = $1 OR ql.hindi_question_id = $1
            LIMIT 1;
        `;

        const res = await client.query(query, [questionId]);

        if (res.rows.length === 0) {
            // Fallback: fetch as solo question from question_version
            const soloRes = await client.query(`
                SELECT
                    qv.question_id,
                    qv.version_no,
                    qv.language,
                    qv.body_json->>'text' AS question_stem,
                    qv.paper_session_id,
                    qv.source_question_no,
                    qv.question_number_int,
                    qv.difficulty,
                    qv.subtype,
                    qv.correct_option_label,
                    qv.final_answer_text,
                    qv.solution_status,
                    qv.solution_json,
                    qv.status AS qv_status,
                    es.code AS section_code,
                    e.name AS exam_name,
                    ps.session_label,
                    ps.paper_date,
                    ps.shift_label,
                    ps.language AS paper_language,
                    j.source_pdf_path,
                    (
                        SELECT jsonb_object_agg(qo.option_key, qo.option_json->>'text' ORDER BY qo.option_key)
                        FROM question_option qo
                        WHERE qo.question_id = qv.question_id
                        AND qo.version_no = qv.version_no
                        AND qo.language = qv.language
                    ) AS options
                FROM question_version qv
                LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
                LEFT JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
                LEFT JOIN exam e ON e.exam_id = ps.exam_id
                LEFT JOIN raw_mmd_doc d ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
                LEFT JOIN import_job  j ON d.import_job_id   = j.import_job_id
                WHERE qv.question_id = $1
                LIMIT 1
            `, [questionId]);

            if (soloRes.rows.length === 0) {
                return Response.json({ success: false, data: null, error: 'Question not found.' }, { status: 404 });
            }

            const solo = soloRes.rows[0];
            const isEn = solo.language === 'EN';

            // Return in the same shape as linked data, with one side populated
            return Response.json({
                success: true,
                solo: true,
                data: {
                    english_question_id: isEn ? solo.question_id : null,
                    hindi_question_id: !isEn ? solo.question_id : null,
                    english_paper_session_id: isEn ? solo.paper_session_id : null,
                    hindi_paper_session_id: !isEn ? solo.paper_session_id : null,
                    english_qno: isEn ? solo.question_number_int : null,
                    hindi_qno: !isEn ? solo.question_number_int : null,
                    english_question_stem: isEn ? solo.question_stem : null,
                    hindi_question_stem: !isEn ? solo.question_stem : null,
                    english_options: isEn ? solo.options : null,
                    hindi_options: !isEn ? solo.options : null,
                    english_correct: isEn ? solo.correct_option_label : null,
                    hindi_correct: !isEn ? solo.correct_option_label : null,
                    english_difficulty: isEn ? solo.difficulty : null,
                    hindi_difficulty: !isEn ? solo.difficulty : null,
                    english_subtype: isEn ? solo.subtype : null,
                    english_solution_status: isEn ? solo.solution_status : null,
                    hindi_solution_status: !isEn ? solo.solution_status : null,
                    english_solution_json: isEn ? solo.solution_json : null,
                    hindi_solution_json: !isEn ? solo.solution_json : null,
                    exam_name: solo.exam_name,
                    session_label: solo.session_label,
                    paper_date: solo.paper_date,
                    shift_label: solo.shift_label,
                    section_code: solo.section_code,
                    language: solo.language,
                    // Map into the same shape as linked for the available side
                    [`${isEn ? 'english' : 'hindi'}_session_label`]: solo.session_label,
                    [`${isEn ? 'english' : 'hindi'}_paper_date`]: solo.paper_date,
                    [`${isEn ? 'english' : 'hindi'}_shift_label`]: solo.shift_label,
                    [`${isEn ? 'english' : 'hindi'}_exam_name`]: solo.exam_name,
                    [`${isEn ? 'english' : 'hindi'}_section_code`]: solo.section_code,
                    [`${isEn ? 'english' : 'hindi'}_source_qno`]: solo.source_question_no,
                    [`${isEn ? 'english' : 'hindi'}_pdf_path`]: solo.source_pdf_path,
                },
            });
        }

        return Response.json({ success: true, data: res.rows[0] });

    } catch (e) {
        console.error('Error fetching question review data:', e);
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    } finally {
        client.release();
    }
}
