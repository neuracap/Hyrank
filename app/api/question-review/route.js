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

                hi.paper_session_id      AS hindi_paper_session_id,
                hi.language              AS hindi_language,
                hi.question_number_int   AS hindi_qno,
                hi.body_json->>'text'    AS hindi_question_stem,

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
                ) AS hindi_options

            FROM public.question_links ql
            JOIN public.question_version en
                ON en.question_id = ql.english_question_id
               AND en.version_no  = ql.english_version_no
               AND en.language    = ql.english_language
            JOIN public.question_version hi
                ON hi.question_id = ql.hindi_question_id
               AND hi.version_no  = ql.hindi_version_no
               AND hi.language    = ql.hindi_language
            WHERE ql.english_question_id = $1 OR ql.hindi_question_id = $1
            LIMIT 1;
        `;

        const res = await client.query(query, [questionId]);

        if (res.rows.length === 0) {
            // Also attempt to check if question exists in question_version alone if link not found
            return Response.json({ success: false, data: null, error: 'Question link not found for the provided ID. Note: Only questions that are linked translated pairs (English & Hindi) will appear.' }, { status: 404 });
        }

        return Response.json({ success: true, data: res.rows[0] });

    } catch (e) {
        console.error('Error fetching question review data:', e);
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    } finally {
        client.release();
    }
}
