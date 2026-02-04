import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
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
                ps.questions_reviewed
            FROM paper_session ps
            ORDER BY ps.paper_date DESC 
            LIMIT 100
        `;
        const res = await client.query(query);
        papers = res.rows;
    } else {
        // Reviewer: See assigned papers WITH PROGRESS
        // Correlated subqueries for progress tracking per-paper-pair
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
                    FROM question_links ql 
                    WHERE ql.paper_session_id_english = ps.paper_session_id 
                       OR ql.paper_session_id_hindi = ps.paper_session_id
                ) as total_q,
                (
                    SELECT COUNT(*) 
                    FROM question_links ql 
                    WHERE (ql.paper_session_id_english = ps.paper_session_id 
                       OR ql.paper_session_id_hindi = ps.paper_session_id)
                       AND ql.status = 'MANUALLY_CORRECTED'
                ) as corrected_q
            FROM review_assignments ra
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
            WHERE ra.reviewer_id = $1
            ORDER BY ra.assigned_at DESC, ps.paper_date DESC
        `;
        const res = await client.query(query, [user.id]);
        papers = res.rows;
    }

    client.release();

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
                    <Link href="/analytics" className="text-blue-600 hover:text-blue-800 font-medium">
                        View Analytics &rarr;
                    </Link>
                )}
            </header>

            <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-800">
                        {user.isAdmin ? 'All Papers' : 'Your Assigned Papers'}
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
                                    <th className="px-6 py-3">Status / Progress</th>
                                    <th className="px-6 py-3">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {papers.map((paper) => {
                                    // Calculate progress if available
                                    const total = parseInt(paper.total_q || 0);
                                    const corrected = parseInt(paper.corrected_q || 0);
                                    const percent = total > 0 ? Math.round((corrected / total) * 100) : 0;
                                    const showProgress = !user.isAdmin && total > 0;

                                    return (
                                        <tr key={paper.paper_session_id} className="bg-white border-b hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {paper.paper_date ? new Date(paper.paper_date).toLocaleDateString() : 'N/A'}
                                            </td>
                                            <td className="px-6 py-4 font-medium text-gray-900">
                                                {paper.caption || paper.session_label}
                                                {paper.subject && <div className="text-xs text-gray-400 font-normal">{paper.subject}</div>}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${paper.language === 'EN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
                                                    }`}>
                                                    {paper.language}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                {showProgress ? (
                                                    // Progress Bar for Reviewers
                                                    <div className="w-full max-w-[140px]">
                                                        <div className="flex justify-between text-xs mb-1">
                                                            <span className={`font-semibold ${paper.assignment_status === 'COMPLETED' ? 'text-green-600' : 'text-yellow-600'}`}>
                                                                {paper.assignment_status === 'COMPLETED' ? 'Done' : 'In Progress'}
                                                            </span>
                                                            <span className="text-gray-500">{corrected}/{total}</span>
                                                        </div>
                                                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                                                            <div
                                                                className={`h-1.5 rounded-full ${paper.assignment_status === 'COMPLETED' ? 'bg-green-500' : 'bg-blue-500'}`}
                                                                style={{ width: `${percent}%` }}
                                                            ></div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    // Simple Status for Admins (or if no progress data)
                                                    user.isAdmin ? (
                                                        paper.questions_reviewed ? (
                                                            <span className="text-green-600 font-bold flex items-center">
                                                                <span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span> Reviewed
                                                            </span>
                                                        ) : (
                                                            <span className="text-gray-400 flex items-center">
                                                                <span className="w-2 h-2 rounded-full bg-gray-300 mr-2"></span> Pending
                                                            </span>
                                                        )
                                                    ) : (
                                                        <span className="text-gray-400">Loading...</span>
                                                    )
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <Link
                                                    href={`/bilingual/${paper.paper_session_id}`}
                                                    className="font-medium text-blue-600 dark:text-blue-500 hover:underline"
                                                >
                                                    Open Review
                                                </Link>
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
