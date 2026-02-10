import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export const metadata = {
    title: 'BiLingDash - Hyrank',
    description: 'Bilingual Paper Linking Dashboard'
};

export default async function BiLingDashPage({ searchParams }) {
    console.log('Rendering BiLingDash Page');
    // 1. Authenticate - Admin Only
    const user = await getCurrentUser();
    if (!user) {
        redirect('/login');
    }
    if (!user.isAdmin) {
        redirect('/dashboard');
    }

    const { page = '1', limit = '50' } = searchParams;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const client = await db.connect();

    // 2. Fetch Bilingual Linking Data
    let bilingualPapers = [];
    let totalCount = 0;
    try {
        // Get total count first for pagination
        const countQuery = `
            SELECT COUNT(*) 
            FROM (
                SELECT 1
                FROM paper_session s1
                JOIN paper_session s2 
                    ON s1.exam_id = s2.exam_id 
                    AND s1.paper_date = s2.paper_date 
                    AND s1.shift_number = s2.shift_number
                JOIN exam e ON s1.exam_id = e.exam_id
                WHERE s1.language = 'EN' AND s2.language = 'HI'
                GROUP BY e.name, s1.paper_date, s1.shift_number, s1.paper_session_id, s2.paper_session_id
            ) as count_table
        `;
        const countRes = await client.query(countQuery);
        totalCount = parseInt(countRes.rows[0]?.count || 0);

        const query = `
            SELECT 
                e.name AS exam_name,
                s1.paper_date,
                s1.shift_number,
                s1.paper_session_id AS english_session_id,
                s2.paper_session_id AS hindi_session_id,
                COUNT(DISTINCT ql.id) AS questions_linked,
                ROUND(AVG(ql.similarity_score)::numeric, 2) AS avg_score,
                STRING_AGG(DISTINCT u1.name, ', ') AS english_reviewers,
                STRING_AGG(DISTINCT u2.name, ', ') AS hindi_reviewers
            FROM paper_session s1
            JOIN paper_session s2 
                ON s1.exam_id = s2.exam_id 
                AND s1.paper_date = s2.paper_date 
                AND s1.shift_number = s2.shift_number
            JOIN exam e ON s1.exam_id = e.exam_id
            LEFT JOIN question_links ql 
                ON s1.paper_session_id = ql.paper_session_id_english 
                AND s2.paper_session_id = ql.paper_session_id_hindi
            LEFT JOIN review_assignments ra1 ON s1.paper_session_id = ra1.paper_session_id
            LEFT JOIN users u1 ON ra1.reviewer_id = u1.id
            LEFT JOIN review_assignments ra2 ON s2.paper_session_id = ra2.paper_session_id
            LEFT JOIN users u2 ON ra2.reviewer_id = u2.id
            WHERE s1.language = 'EN' AND s2.language = 'HI'
            GROUP BY e.name, s1.paper_date, s1.shift_number, s1.paper_session_id, s2.paper_session_id
            ORDER BY s1.paper_date DESC, s1.shift_number ASC
            LIMIT $1 OFFSET $2
        `;
        const res = await client.query(query, [limitNum, offset]);
        bilingualPapers = res.rows;
    } catch (e) {
        console.error('Error fetching bilingual data:', e);
    } finally {
        client.release();
    }

    const totalPages = Math.ceil(totalCount / limitNum);

    return (
        <div className="container mx-auto px-4 py-8">
            <header className="mb-8 flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">BiLingDash</h1>
                    <p className="text-gray-500 mt-1">
                        Bilingual Paper Linking Dashboard
                    </p>
                </div>
                <Link href="/dashboard" className="text-blue-600 hover:text-blue-800 font-medium">
                    ← Back to Dashboard
                </Link>
            </header>

            <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-gray-800">
                            Bilingual Paper Linking Status
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                            Total Papers: {totalCount} | Page {pageNum} of {totalPages}
                        </p>
                    </div>
                </div>

                {bilingualPapers.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        No bilingual papers found.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-500">
                            <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3">S.No.</th>
                                    <th className="px-6 py-3">Exam Name</th>
                                    <th className="px-6 py-3">Paper Date</th>
                                    <th className="px-6 py-3">Shift</th>
                                    <th className="px-6 py-3">Hindi Paper</th>
                                    <th className="px-6 py-3">English Paper</th>
                                    <th className="px-6 py-3">Questions Linked</th>
                                    <th className="px-6 py-3">Assigned to</th>
                                    <th className="px-6 py-3">Bilingual Review</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bilingualPapers.map((paper, idx) => {
                                    const linkedCount = parseInt(paper.questions_linked || 0);
                                    const avgScore = paper.avg_score || 0;
                                    const serialNumber = offset + idx + 1;

                                    return (
                                        <tr key={idx} className="bg-white border-b hover:bg-gray-50">
                                            <td className="px-6 py-4 font-medium text-gray-900">
                                                {serialNumber}
                                            </td>
                                            <td className="px-6 py-4 font-medium text-gray-900">
                                                {paper.exam_name}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {paper.paper_date ? new Date(paper.paper_date).toLocaleDateString('en-IN', {
                                                    year: 'numeric',
                                                    month: 'short',
                                                    day: 'numeric'
                                                }) : 'N/A'}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="px-2 py-1 rounded text-xs font-bold bg-gray-100 text-gray-800">
                                                    Shift {paper.shift_number || 'N/A'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <Link
                                                    href={`/test?testId=${paper.hindi_session_id}&locked=true`}
                                                    className="inline-block px-3 py-1 bg-orange-600 text-white text-xs font-bold rounded hover:bg-orange-700 transition-colors"
                                                >
                                                    HI Paper
                                                </Link>
                                            </td>
                                            <td className="px-6 py-4">
                                                <Link
                                                    href={`/test?testId=${paper.english_session_id}&locked=true`}
                                                    className="inline-block px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 transition-colors"
                                                >
                                                    EN Paper
                                                </Link>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <span className={`font-bold ${linkedCount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                        {linkedCount} questions
                                                    </span>
                                                    {avgScore > 0 && (
                                                        <span className="text-xs text-gray-500">
                                                            Avg: {avgScore}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                {(() => {
                                                    const enReviewers = paper.english_reviewers?.split(', ').filter(Boolean) || [];
                                                    const hiReviewers = paper.hindi_reviewers?.split(', ').filter(Boolean) || [];
                                                    const allReviewers = [...new Set([...enReviewers, ...hiReviewers])];

                                                    if (allReviewers.length === 0) {
                                                        return <span className="text-red-600 font-semibold">Unassigned</span>;
                                                    }

                                                    return (
                                                        <div className="flex flex-col gap-1">
                                                            {allReviewers.map((reviewer, i) => (
                                                                <span key={i} className="text-sm text-gray-900">
                                                                    {reviewer}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                            <td className="px-6 py-4">
                                                <Link
                                                    href={`/bilingual/${paper.english_session_id}`}
                                                    className="inline-block px-3 py-1 bg-purple-600 text-white text-xs font-bold rounded hover:bg-purple-700 transition-colors"
                                                >
                                                    Review
                                                </Link>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
                        <div>
                            <span className="text-sm text-gray-700">
                                Showing <span className="font-medium">{offset + 1}</span> to <span className="font-medium">{Math.min(offset + limitNum, totalCount)}</span> of <span className="font-medium">{totalCount}</span> results
                            </span>
                        </div>
                        <div className="flex gap-2">
                            {pageNum > 1 && (
                                <Link
                                    href={`/bilingdash?page=${pageNum - 1}&limit=${limitNum}`}
                                    className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                                >
                                    Previous
                                </Link>
                            )}
                            {pageNum < totalPages && (
                                <Link
                                    href={`/bilingdash?page=${pageNum + 1}&limit=${limitNum}`}
                                    className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                                >
                                    Next
                                </Link>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
