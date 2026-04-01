import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function MyReviewsPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');

    const client = await db.connect();

    try {
        const query = `
            SELECT
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.caption,
                ps.subject,
                ps.language,
                ps.status as pipeline_status,
                e.name as exam_name,
                (
                    SELECT COUNT(*)
                    FROM question_version qv
                    WHERE qv.paper_session_id = ps.paper_session_id
                ) as total_q,
                (
                    SELECT COUNT(*)
                    FROM question_version qv
                    WHERE qv.paper_session_id = ps.paper_session_id
                    AND qv.status = 'MANUALLY_CORRECTED'
                ) as corrected_count,
                (
                    SELECT COUNT(*)
                    FROM question_version qv
                    WHERE qv.paper_session_id = ps.paper_session_id
                    AND qv.status = 'FLAGGED'
                ) as flagged_count
            FROM review_assignments ra
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            WHERE ra.reviewer_id = $1
              AND ps.status = 'TEAM_REVIEWED'
            ORDER BY e.name ASC NULLS LAST, ps.paper_date DESC
        `;
        const res = await client.query(query, [user.id]);
        const allPapers = res.rows;

        const missingPapers = allPapers.filter(p => parseInt(p.total_q || 0) < 100);
        const completePapers = allPapers.filter(p => parseInt(p.total_q || 0) >= 100);

        const renderTable = (papers, emptyMsg) => {
            if (papers.length === 0) {
                return <div className="p-8 text-center text-gray-400">{emptyMsg}</div>;
            }
            return (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                            <tr>
                                <th className="px-6 py-3">Date</th>
                                <th className="px-6 py-3">Exam</th>
                                <th className="px-6 py-3">Paper Name</th>
                                <th className="px-6 py-3">Lang</th>
                                <th className="px-6 py-3">Questions</th>
                                <th className="px-6 py-3">Corrected</th>
                                <th className="px-6 py-3">Flagged</th>
                                <th className="px-6 py-3">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {papers.map((paper) => {
                                const totalQ = parseInt(paper.total_q || 0);
                                const corrected = parseInt(paper.corrected_count || 0);
                                const flagged = parseInt(paper.flagged_count || 0);
                                return (
                                    <tr key={paper.paper_session_id} className="bg-white border-b hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                                            {paper.paper_date ? new Date(paper.paper_date).toLocaleDateString() : 'N/A'}
                                        </td>
                                        <td className="px-6 py-4">
                                            {paper.exam_name ? (
                                                <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2 py-1 rounded">
                                                    {paper.exam_name}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400 text-xs">—</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 font-medium text-gray-900">
                                            {paper.session_label}
                                            {paper.subject && <div className="text-xs text-gray-400 font-normal">{paper.subject}</div>}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${paper.language === 'EN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}`}>
                                                {paper.language}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`font-bold px-2 py-1 rounded ${totalQ < 100 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                                                {totalQ}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`font-bold px-2 py-1 rounded ${corrected > 0 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                                                {corrected}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {flagged > 0 ? (
                                                <span className="font-bold px-2 py-1 rounded bg-orange-100 text-orange-700">{flagged}</span>
                                            ) : (
                                                <span className="text-gray-300 text-xs">—</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <Link
                                                href={`/test?testId=${paper.paper_session_id}&locked=true`}
                                                prefetch={false}
                                                className="px-3 py-1 bg-teal-600 text-white text-xs font-bold rounded hover:bg-teal-700 shadow-sm"
                                            >
                                                View Paper
                                            </Link>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            );
        };

        return (
            <div className="container mx-auto px-4 py-8">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">My Reviewed Papers</h1>
                    <p className="text-gray-500 mt-1">
                        Papers you have reviewed with status TEAM_REVIEWED — {allPapers.length} total
                    </p>
                </header>

                {/* Top Pane: Missing Questions */}
                <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden mb-8">
                    <div className="px-6 py-4 border-b border-gray-200 bg-red-50">
                        <h2 className="text-lg font-bold text-red-800">
                            Add Missing Questions
                            <span className="ml-2 bg-red-100 text-red-700 text-sm font-semibold px-2.5 py-0.5 rounded-full">
                                {missingPapers.length} papers
                            </span>
                        </h2>
                        <p className="text-sm text-red-600 mt-1">These papers have fewer than 100 questions and need missing questions added.</p>
                    </div>
                    {renderTable(missingPapers, 'All papers have 100+ questions!')}
                </div>

                {/* Bottom Pane: Complete Papers */}
                <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-200 bg-green-50">
                        <h2 className="text-lg font-bold text-green-800">
                            Complete Papers
                            <span className="ml-2 bg-green-100 text-green-700 text-sm font-semibold px-2.5 py-0.5 rounded-full">
                                {completePapers.length} papers
                            </span>
                        </h2>
                        <p className="text-sm text-green-600 mt-1">These papers have 100 or more questions.</p>
                    </div>
                    {renderTable(completePapers, 'No complete papers yet.')}
                </div>
            </div>
        );
    } finally {
        client.release();
    }
}
