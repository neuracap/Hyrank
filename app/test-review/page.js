import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function TestReviewPage() {
    // 1. Authenticate
    const user = await getCurrentUser();
    if (!user) {
        redirect('/login');
    }

    const client = await db.connect();

    // 2. Fetch Papers based on Role
    let papers = [];
    if (user.isAdmin) {
        // Admin: See recent papers
        const query = `
            SELECT 
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.caption,
                ps.subject,
                ps.language,
                ps.status as pipeline_status,
                (
                    SELECT COUNT(*) 
                    FROM question_version qv
                    WHERE qv.paper_session_id = ps.paper_session_id
                ) as total_q
            FROM paper_session ps
            ORDER BY ps.paper_date DESC 
            LIMIT 100
        `;
        const res = await client.query(query);
        papers = res.rows;
    } else {
        // Reviewer: See assigned papers
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
                (
                    SELECT COUNT(*) 
                    FROM question_version qv
                    WHERE qv.paper_session_id = ps.paper_session_id
                ) as total_q
            FROM review_assignments ra
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
            WHERE ra.reviewer_id = $1
            ORDER BY ra.assigned_at DESC, ps.paper_date DESC
            LIMIT 50
        `;
        const res = await client.query(query, [user.id]);
        papers = res.rows;
    }

    client.release();

    // Helper to render the status pill
    const getStatusPill = (statusStr) => {
        const statusMap = {
            'NOT_REVIEWED': { label: 'Not Reviewed', color: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400' },
            'TEAM_REVIEWED': { label: 'Team Reviewed', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
            'ADMIN_REVIEWED': { label: 'Admin Reviewed', color: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
            'MISSING_ADDED': { label: 'Missing Added', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
            'PRE_PUBLISH_READY': { label: 'Pre-Publish Ready', color: 'bg-teal-100 text-teal-700', dot: 'bg-teal-500' },
            'SOLUTION_REVIEW': { label: 'Solution Review', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
            'PRODUCTION': { label: 'Production', color: 'bg-green-100 text-green-800', dot: 'bg-green-500' }
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

            <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-800">
                        {user.isAdmin ? 'All Papers' : 'Your Assigned Papers (All Languages)'}
                    </h2>
                </div>

                {papers.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        No papers found.
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
                                    <th className="px-6 py-3">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {papers.map((paper) => {
                                    return (
                                        <tr key={paper.paper_session_id} className="bg-white border-b hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {paper.paper_date ? new Date(paper.paper_date).toLocaleDateString() : 'N/A'}
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
                                                <span className="font-bold text-gray-900">
                                                    {parseInt(paper.total_q || 0)}
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
