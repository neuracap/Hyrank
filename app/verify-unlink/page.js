import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { redirect } from 'next/navigation';
import VerifyUnlink from '@/components/VerifyUnlink';

export const dynamic = 'force-dynamic';

async function fetchUnverifiedQuestions(page = 1, limit = 100) {
    const offset = (page - 1) * limit;
    let client;

    try {
        client = await db.connect();

        // Paper sessions that have >90 verified questions
        const qualifiedSessionsQuery = `
            SELECT paper_session_id
            FROM question_version
            WHERE is_verified = TRUE
            GROUP BY paper_session_id
            HAVING COUNT(*) > 90
        `;

        // Unverified questions from those sessions
        const questionsRes = await client.query(`
            WITH qualified_sessions AS (${qualifiedSessionsQuery})
            SELECT
                qv.question_id          AS id,
                qv.version_no,
                qv.language,
                qv.body_json->>'text'   AS question_text,
                qv.has_image            AS has_figure,
                qv.source_question_no,
                qv.difficulty,
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                e.name                  AS exam_name,
                j.source_pdf_path
            FROM question_version qv
            JOIN qualified_sessions qs ON qv.paper_session_id = qs.paper_session_id
            JOIN paper_session ps       ON qv.paper_session_id = ps.paper_session_id
            LEFT JOIN exam e            ON ps.exam_id = e.exam_id
            LEFT JOIN raw_mmd_doc d     ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
            LEFT JOIN import_job j      ON d.import_job_id = j.import_job_id
            WHERE (qv.is_verified = FALSE OR qv.is_verified IS NULL)
            ORDER BY ps.paper_date DESC NULLS LAST,
                     CAST(SUBSTRING(qv.source_question_no FROM '[0-9]+') AS INTEGER) ASC NULLS LAST,
                     qv.question_id ASC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        const questions = questionsRes.rows;

        // Total count
        const countRes = await client.query(`
            WITH qualified_sessions AS (${qualifiedSessionsQuery})
            SELECT COUNT(*) AS c
            FROM question_version qv
            JOIN qualified_sessions qs ON qv.paper_session_id = qs.paper_session_id
            WHERE (qv.is_verified = FALSE OR qv.is_verified IS NULL)
        `);
        const total = parseInt(countRes.rows[0].c, 10);

        // Fetch options for all questions
        const allIds = questions.map(q => q.id);
        let allOptions = [];
        if (allIds.length > 0) {
            const optRes = await client.query(`
                SELECT
                    question_id,
                    version_no,
                    language,
                    option_key  AS opt_label,
                    option_json->>'text' AS opt_text
                FROM question_option
                WHERE question_id = ANY($1)
                ORDER BY option_key ASC
            `, [allIds]);
            allOptions = optRes.rows;
        }

        const enriched = questions.map(q => ({
            ...q,
            options: allOptions.filter(
                o => o.question_id === q.id && o.version_no === q.version_no && o.language === q.language
            )
        }));

        return { questions: enriched, total, totalPages: Math.ceil(total / limit) };

    } catch (e) {
        console.error('fetchUnverifiedQuestions error:', e);
        return { questions: [], total: 0, totalPages: 0 };
    } finally {
        client?.release();
    }
}

export default async function VerifyUnlinkPage({ searchParams }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) redirect('/login');

    const page = parseInt((await searchParams)?.page || '1', 10);
    const { questions, total, totalPages } = await fetchUnverifiedQuestions(page, 100);

    return (
        <div className="bg-gray-50 min-h-screen">
            <div className="container mx-auto px-4 py-8">
                <header className="mb-8 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                    <h1 className="text-2xl font-bold text-gray-900 mb-1">Verify UnLink</h1>
                    <p className="text-sm text-gray-500">
                        Unverified questions from papers where 90+ questions are already verified.
                        Edit and save to mark each question as verified.
                    </p>
                    <p className="text-sm font-semibold text-gray-700 mt-2">
                        {total} question{total !== 1 ? 's' : ''} remaining
                    </p>
                </header>

                <VerifyUnlink
                    initialQuestions={questions}
                    total={total}
                    currentPage={page}
                    totalPages={totalPages}
                />
            </div>
        </div>
    );
}
