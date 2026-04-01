import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import TestReviewFilters from '@/components/TestReviewFilters';

export const dynamic = 'force-dynamic';

export default async function TestReviewPage({ searchParams }) {
    // 1. Authenticate
    const user = await getCurrentUser();
    if (!user) {
        redirect('/login');
    }

    const { exam = 'ALL', qcount = 'ALL', status = 'ALL' } = await searchParams || {};

    const client = await db.connect();

    // Fetch distinct exam names for the filter dropdown
    const examsRes = await client.query(`
        SELECT DISTINCT e.name FROM exam e
        WHERE e.name IS NOT NULL
        ORDER BY e.name ASC
    `);
    const availableExams = examsRes.rows.map(r => r.name);

    // 2. Fetch Papers based on Role
    let papers = [];
    if (user.isAdmin) {
        const whereConditions = [];
        const queryParams = [];
        let paramIndex = 1;

        if (exam !== 'ALL') {
            whereConditions.push(`e.name = $${paramIndex}`);
            queryParams.push(exam);
            paramIndex++;
        }

        if (status !== 'ALL') {
            whereConditions.push(`ps.status = $${paramIndex}`);
            queryParams.push(status);
            paramIndex++;
        }

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

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
                ) as total_q
            FROM paper_session ps
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            ${whereClause}
            ORDER BY ps.paper_date DESC
            LIMIT 200
        `;
        const res = await client.query(query, queryParams);
        papers = res.rows;
    } else {
        const whereConditions = [`ra.reviewer_id = $1`];
        const queryParams = [user.id];
        let paramIndex = 2;

        whereConditions.push(`NOT EXISTS (
            SELECT 1 FROM question_links ql
            WHERE ql.paper_session_id_english = ps.paper_session_id
               OR ql.paper_session_id_hindi = ps.paper_session_id
        )`);

        if (exam !== 'ALL') {
            whereConditions.push(`e.name = $${paramIndex}`);
            queryParams.push(exam);
            paramIndex++;
        }

        if (status !== 'ALL') {
            whereConditions.push(`ps.status = $${paramIndex}`);
            queryParams.push(status);
            paramIndex++;
        }

        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

        const query = `
            SELECT
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.caption,
                ps.subject,
                ps.language,
                ps.status as pipeline_status,
                ra.status as assignment_status,
                e.name as exam_name,
                (
                    SELECT COUNT(*)
                    FROM question_version qv
                    WHERE qv.paper_session_id = ps.paper_session_id
                ) as total_q
            FROM review_assignments ra
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            ${whereClause}
            ORDER BY ra.assigned_at DESC, ps.paper_date DESC
            LIMIT 100
        `;
        const res = await client.query(query, queryParams);
        papers = res.rows;
    }

    // Fetch exam-wise status summary (always, regardless of filters)
    const statsRes = await client.query(`
        SELECT
            COALESCE(e.name, 'Unknown') AS exam_name,
            ps.status,
            COUNT(*) AS cnt
        FROM paper_session ps
        LEFT JOIN exam e ON e.exam_id = ps.exam_id
        GROUP BY e.name, ps.status
        ORDER BY e.name, ps.status
    `);

    // Build stats table: { examName: { status: count, ... }, ... }
    const statsMap = {};
    const allStatuses = new Set();
    for (const row of statsRes.rows) {
        if (!statsMap[row.exam_name]) statsMap[row.exam_name] = {};
        statsMap[row.exam_name][row.status] = parseInt(row.cnt);
        allStatuses.add(row.status);
    }
    const statusList = [
        'NOT_REVIEWED', 'TEAM_REVIEWED', 'ADMIN_REVIEWED', 'MISSING_ADDED',
        'PRE_PUBLISH_READY', 'SOLUTION_REVIEW', 'PRODUCTION', 'NOT_WORTHY'
    ].filter(s => allStatuses.has(s));

    client.release();

    // Apply question count filter in JS (since it's on a subquery count)
    if (qcount === 'lt100') {
        papers = papers.filter(p => parseInt(p.total_q || 0) < 100);
    } else if (qcount === 'gte100') {
        papers = papers.filter(p => parseInt(p.total_q || 0) >= 100);
    }

    // Helper to render the status pill
    const getStatusPill = (statusStr) => {
        const statusMap = {
            'NOT_REVIEWED': { label: 'Not Reviewed', color: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400' },
            'TEAM_REVIEWED': { label: 'Team Reviewed', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
            'ADMIN_REVIEWED': { label: 'Admin Reviewed', color: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
            'MISSING_ADDED': { label: 'Missing Added', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
            'PRE_PUBLISH_READY': { label: 'Pre-Publish Ready', color: 'bg-teal-100 text-teal-700', dot: 'bg-teal-500' },
            'SOLUTION_REVIEW': { label: 'Solution Review', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
            'PRODUCTION': { label: 'Production', color: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
            'NOT_WORTHY': { label: 'Not Worthy', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' }
        };

        const config = statusMap[statusStr] || { label: statusStr || 'Unknown', color: 'bg-gray-100 text-gray-800', dot: 'bg-gray-500' };

        return (
            <span className={`font-medium flex items-center gap-1.5 px-2.5 py-1 rounded-full w-fit ${config.color}`}>
                <div className={`w-2 h-2 rounded-full ${config.dot}`}></div>
                {config.label}
            </span>
        );
    };

    return (
        <div className="container mx-auto px-4 py-8">
            <header className="mb-8 flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Test Review Dashboard</h1>
                    <p className="text-gray-500 mt-1">
                        Welcome back, {user.name} ({user.isAdmin ? 'Admin' : 'Reviewer'})
                    </p>
                </div>
            </header>

            {/* Exam-wise Status Summary */}
            {user.isAdmin && Object.keys(statsMap).length > 0 && (
                <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden mb-6">
                    <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
                        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Exam-wise Paper Status Summary</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-gray-50 border-b">
                                    <th className="text-left px-3 py-2 font-bold text-gray-600">Exam</th>
                                    {statusList.map(s => (
                                        <th key={s} className="text-center px-2 py-2 font-bold text-gray-600 whitespace-nowrap">
                                            {s.replace(/_/g, ' ')}
                                        </th>
                                    ))}
                                    <th className="text-center px-3 py-2 font-bold text-gray-800">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(statsMap).sort((a, b) => a[0].localeCompare(b[0])).map(([examName, counts]) => {
                                    const total = Object.values(counts).reduce((s, c) => s + c, 0);
                                    return (
                                        <tr key={examName} className="border-b border-gray-100 hover:bg-gray-50">
                                            <td className="px-3 py-1.5 font-semibold text-gray-800 whitespace-nowrap">{examName}</td>
                                            {statusList.map(s => (
                                                <td key={s} className="text-center px-2 py-1.5">
                                                    {counts[s] ? <span className="font-bold">{counts[s]}</span> : <span className="text-gray-300">-</span>}
                                                </td>
                                            ))}
                                            <td className="text-center px-3 py-1.5 font-bold text-gray-800">{total}</td>
                                        </tr>
                                    );
                                })}
                                <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                                    <td className="px-3 py-2 text-gray-800">Total</td>
                                    {statusList.map(s => {
                                        const colTotal = Object.values(statsMap).reduce((sum, counts) => sum + (counts[s] || 0), 0);
                                        return <td key={s} className="text-center px-2 py-2">{colTotal || '-'}</td>;
                                    })}
                                    <td className="text-center px-3 py-2">
                                        {Object.values(statsMap).reduce((sum, counts) => sum + Object.values(counts).reduce((s, c) => s + c, 0), 0)}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
                <TestReviewFilters exams={availableExams} />

                <div className="px-6 py-4 border-b border-gray-200 bg-white">
                    <h2 className="text-lg font-bold text-gray-800">
                        {user.isAdmin ? 'All Papers' : 'Your Assigned Papers (Do Individually, Cannot be Linked)'}
                        <span className="ml-2 bg-gray-100 text-gray-600 text-sm font-semibold px-2.5 py-0.5 rounded-full">{papers.length} papers</span>
                    </h2>
                </div>

                {papers.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        No papers found matching the current filters.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-500">
                            <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3">Date</th>
                                    <th className="px-6 py-3">Exam</th>
                                    <th className="px-6 py-3">Paper Name</th>
                                    <th className="px-6 py-3">Lang</th>
                                    <th className="px-6 py-3">Questions</th>
                                    <th className="px-6 py-3">Status / Progress</th>
                                    <th className="px-6 py-3">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {papers.map((paper) => {
                                    const totalQ = parseInt(paper.total_q || 0);
                                    return (
                                        <tr key={paper.paper_session_id} className="bg-white border-b hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap">
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
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${paper.language === 'EN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
                                                    }`}>
                                                    {paper.language}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`font-bold px-2 py-1 rounded ${totalQ < 100 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                                                    {totalQ}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                {getStatusPill(paper.pipeline_status)}
                                                {!user.isAdmin && (
                                                    <div className="mt-2 text-xs">
                                                        My Task: <span className={`font-semibold ${paper.assignment_status === 'COMPLETED' ? 'text-green-600' : 'text-yellow-600'}`}>{paper.assignment_status}</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-2">
                                                    <Link
                                                        href={`/test?testId=${paper.paper_session_id}&locked=true`}
                                                        prefetch={false}
                                                        className="block w-full text-center px-3 py-1 bg-teal-600 text-white text-xs font-bold rounded hover:bg-teal-700 transition-colors shadow-sm"
                                                    >
                                                        Test Review
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
            </div>
        </div>
    );
}
