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
        // Reviewer: See assigned papers
        const query = `
            SELECT 
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.caption,
                ps.subject,
                ps.language,
                ps.questions_reviewed,
                ra.status as assignment_status
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
                                    <th className="px-6 py-3">Status</th>
                                    <th className="px-6 py-3">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {papers.map((paper) => (
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
                                            {user.isAdmin ? (
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
                                                // Reviewer View
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${paper.assignment_status === 'COMPLETED'
                                                        ? 'bg-green-100 text-green-800'
                                                        : 'bg-yellow-100 text-yellow-800'
                                                    }`}>
                                                    {paper.assignment_status || 'PENDING'}
                                                </span>
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
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
