import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import BulkReclassifyButton from '@/components/BulkReclassifyButton';
import DashboardFilters from '@/components/DashboardFilters';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }) {
    // 1. Authenticate
    const user = await getCurrentUser();
    if (!user) {
        redirect('/login');
    }

    const { subject = 'ALL', status = 'ALL', page = '1' } = await searchParams || {};
    const currentPage = Math.max(1, parseInt(page, 10));
    const limit = 50;
    const offset = (currentPage - 1) * limit;

    const client = await db.connect();

    // 2. Fetch distinct subjects for the filter dropdown
    const subjectsRes = await client.query(`SELECT DISTINCT subject FROM paper_session WHERE subject IS NOT NULL ORDER BY subject ASC`);
    const availableSubjects = subjectsRes.rows.map(row => row.subject);

    // 3. Dynamic Query Builder
    let papers = [];
    let totalCount = 0;

    // Conditions array to hold purely dynamic where clauses
    const whereConditions = [];
    const queryParams = [];
    let paramIndex = 1;

    // Build the dynamic filters based on searchParams
    if (subject !== 'ALL') {
        whereConditions.push(`ps.subject = $${paramIndex}`);
        queryParams.push(subject);
        paramIndex++;
    }

    if (user.isAdmin) {
        // --- ADMIN QUERY ---
        if (status === 'COMPLETED') {
            whereConditions.push(`ps.questions_reviewed = TRUE`);
        } else if (status === 'PENDING') {
            whereConditions.push(`ps.questions_reviewed = FALSE`);
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Fetch Count
        const countQuery = `SELECT COUNT(*) FROM paper_session ps ${whereClause}`;
        const countRes = await client.query(countQuery, queryParams);
        totalCount = parseInt(countRes.rows[0].count, 10);

        // Fetch Data
        const query = `
            SELECT 
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.caption,
                ps.subject,
                ps.language,
                ps.questions_reviewed,
                (
                    SELECT COUNT(*) 
                    FROM question_version qv
                    WHERE qv.paper_session_id = ps.paper_session_id
                ) as total_q
            FROM paper_session ps
            ${whereClause}
            ORDER BY ps.paper_date DESC NULLS LAST
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        const res = await client.query(query, [...queryParams, limit, offset]);
        papers = res.rows;
    } else {
        // --- REVIEWER QUERY ---
        whereConditions.push(`ra.reviewer_id = $${paramIndex}`);
        queryParams.push(user.id);
        paramIndex++;

        whereConditions.push(`ps.language = 'EN'`); // Reviewers only see English sessions by default

        if (status === 'COMPLETED') {
            whereConditions.push(`ra.status = 'COMPLETED'`);
        } else if (status === 'PENDING') {
            whereConditions.push(`ra.status != 'COMPLETED'`);
        }

        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

        // Fetch Count
        const countQuery = `
            SELECT COUNT(*) 
            FROM review_assignments ra 
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id 
            ${whereClause}
        `;
        const countRes = await client.query(countQuery, queryParams);
        totalCount = parseInt(countRes.rows[0].count, 10);

        // Fetch Data
        const query = `
            SELECT 
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.caption,
                ps.subject,
                ps.language,
                ps.questions_reviewed,
                ra.status as assignment_status,
                (
                    SELECT COUNT(*) 
                    FROM question_version qv
                    WHERE qv.paper_session_id = ps.paper_session_id
                ) as total_q
            FROM review_assignments ra
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
            ${whereClause}
            ORDER BY ra.assigned_at DESC, ps.paper_date DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        const res = await client.query(query, [...queryParams, limit, offset]);
        papers = res.rows;
    }

    client.release();

    const totalPages = Math.ceil(totalCount / limit);

    return (
        <div className="container mx-auto px-4 py-8">
            <header className="mb-8 flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
                    <p className="text-gray-500 mt-1">
                        Welcome back, {user.name} ({user.isAdmin ? 'Admin' : 'Reviewer'})
                    </p>
                </div>
                {user.isAdmin && (
                    <div className="flex gap-4 items-center flex-wrap">
                        <BulkReclassifyButton />
                        <Link href="/bilingdash" className="text-purple-600 hover:text-purple-800 font-medium">
                            BiLingDash [Beta] →
                        </Link>
                        <Link href="/analytics" className="text-blue-600 hover:text-blue-800 font-medium">
                            View Analytics →
                        </Link>
                        <Link href="/question-review" className="text-orange-600 hover:text-orange-800 font-medium">
                            Question Review →
                        </Link>
                        <Link href="/flagged" className="text-red-600 hover:text-red-800 font-medium">
                            Flagged Questions →
                        </Link>
                    </div>
                )}
            </header>

            <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden mb-8">
                <DashboardFilters subjects={availableSubjects} />

                <div className="px-6 py-4 border-b border-gray-200 bg-white flex justify-between items-center">
                    <h2 className="text-lg font-bold text-gray-800">
                        {user.isAdmin ? 'All Papers' : 'Your Assigned Papers'}
                        <span className="ml-2 bg-gray-100 text-gray-600 text-sm font-semibold px-2.5 py-0.5 rounded-full">{totalCount} total</span>
                    </h2>
                </div>

                {papers.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">
                        No papers found matching the current filters.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-500">
                            <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3">Date</th>
                                    <th className="px-6 py-3">Paper Name</th>
                                    <th className="px-6 py-3">Lang</th>
                                    <th className="px-6 py-3">Questions</th>
                                    <th className="px-6 py-3">Status / Progress</th>
                                    <th className="px-6 py-3 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {papers.map((paper) => {
                                    return (
                                        <tr key={paper.paper_session_id} className="bg-white border-b hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap text-gray-600 font-medium">
                                                {paper.paper_date ? new Date(paper.paper_date).toLocaleDateString() : 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 text-gray-900">
                                                <div className="font-semibold text-sm">{paper.session_label}</div>
                                                {paper.subject && <div className="text-xs text-gray-500 mt-1">{paper.subject}</div>}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${paper.language === 'EN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
                                                    }`}>
                                                    {paper.language}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="font-bold text-gray-900 bg-gray-100 px-2 py-1 rounded">
                                                    {parseInt(paper.total_q || 0)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                {user.isAdmin ? (
                                                    paper.questions_reviewed ? (
                                                        <span className="text-green-600 font-bold flex items-center gap-1.5 bg-green-50 px-2 py-1 rounded-full w-fit">
                                                            <div className="w-2 h-2 rounded-full bg-green-500"></div> Reviewed
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-500 font-medium flex items-center gap-1.5 bg-gray-100 px-2 py-1 rounded-full w-fit">
                                                            <div className="w-2 h-2 rounded-full bg-gray-400"></div> Pending
                                                        </span>
                                                    )
                                                ) : (
                                                    <span className={`font-semibold flex items-center gap-1.5 px-2 py-1 rounded-full w-fit ${paper.assignment_status === 'COMPLETED' ? 'text-green-600 bg-green-50' : 'text-yellow-700 bg-yellow-50'}`}>
                                                        <div className={`w-2 h-2 rounded-full ${paper.assignment_status === 'COMPLETED' ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                                                        {paper.assignment_status === 'COMPLETED' ? 'Completed' : 'In Progress'}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Link
                                                        href={`/bilingual/${paper.paper_session_id}`}
                                                        prefetch={false}
                                                        className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700 transition-colors shadow-sm"
                                                    >
                                                        Review Paper
                                                    </Link>
                                                </div>
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
                    <div className="px-6 py-4 border-t border-gray-200 bg-white flex items-center justify-between">
                        <div className="text-sm text-gray-500">
                            Showing <span className="font-semibold text-gray-900">{((currentPage - 1) * limit) + 1}</span> to <span className="font-semibold text-gray-900">{Math.min(currentPage * limit, totalCount)}</span> of <span className="font-semibold text-gray-900">{totalCount}</span> papers
                        </div>
                        <div className="flex gap-2">
                            {currentPage > 1 && (
                                <Link
                                    href={`/dashboard?page=${currentPage - 1}${subject !== 'ALL' ? `&subject=${subject}` : ''}${status !== 'ALL' ? `&status=${status}` : ''}`}
                                    className="px-3 py-1.5 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50 text-gray-700"
                                >
                                    Previous
                                </Link>
                            )}
                            {currentPage < totalPages && (
                                <Link
                                    href={`/dashboard?page=${currentPage + 1}${subject !== 'ALL' ? `&subject=${subject}` : ''}${status !== 'ALL' ? `&status=${status}` : ''}`}
                                    className="px-3 py-1.5 bg-gray-900 text-white rounded text-sm font-medium hover:bg-gray-800"
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
