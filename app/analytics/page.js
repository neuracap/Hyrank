import db from '@/lib/db';
import { requireAdmin } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
    // 1. Authenticate & Authorize
    await requireAdmin();

    const client = await db.connect();

    // 2. Fetch Aggregated Stats
    const statsRes = await client.query(`
        SELECT 
            u.id as user_id,
            u.name,
            u.email,
            COUNT(ra.id) as total_assigned,
            COUNT(CASE WHEN ra.status = 'COMPLETED' THEN 1 END) as completed_count,
            COUNT(CASE WHEN ra.status = 'PENDING' THEN 1 END) as pending_count
        FROM review_assignments ra
        JOIN users u ON ra.reviewer_id = u.id
        GROUP BY u.id, u.name, u.email
        ORDER BY completed_count DESC, u.name
    `);

    const detailedRes = await client.query(`
        SELECT 
            u.email,
            ps.caption as paper_name,
            ps.language,
            ra.status,
            ra.assigned_at
        FROM review_assignments ra
        JOIN users u ON ra.reviewer_id = u.id
        JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
        ORDER BY u.email, ra.status, ps.language
    `);

    client.release();

    const stats = statsRes.rows;
    const details = detailedRes.rows;

    return (
        <div className="container mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">Analytics Dashboard</h1>

            {/* Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
                    <h3 className="text-sm font-bold text-gray-500 uppercase">Total Assignments</h3>
                    <p className="text-4xl font-bold text-blue-600 mt-2">
                        {stats.reduce((acc, curr) => acc + parseInt(curr.total_assigned), 0)}
                    </p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
                    <h3 className="text-sm font-bold text-gray-500 uppercase">Completed</h3>
                    <p className="text-4xl font-bold text-green-600 mt-2">
                        {stats.reduce((acc, curr) => acc + parseInt(curr.completed_count), 0)}
                    </p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
                    <h3 className="text-sm font-bold text-gray-500 uppercase">Pending</h3>
                    <p className="text-4xl font-bold text-yellow-600 mt-2">
                        {stats.reduce((acc, curr) => acc + parseInt(curr.pending_count), 0)}
                    </p>
                </div>
            </div>

            {/* Reviewer Progress Table */}
            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden mb-12">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-800">Reviewer Progress</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                            <tr>
                                <th className="px-6 py-3">Reviewer</th>
                                <th className="px-6 py-3">Assigned</th>
                                <th className="px-6 py-3">Completed</th>
                                <th className="px-6 py-3">Pending</th>
                                <th className="px-6 py-3">Progress</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.map((user) => {
                                const total = parseInt(user.total_assigned);
                                const completed = parseInt(user.completed_count);
                                const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

                                return (
                                    <tr key={user.user_id} className="bg-white border-b hover:bg-gray-50">
                                        <td className="px-6 py-4 font-medium text-gray-900">
                                            {user.name} <br />
                                            <span className="text-gray-400 font-normal text-xs">{user.email}</span>
                                        </td>
                                        <td className="px-6 py-4">{total}</td>
                                        <td className="px-6 py-4 text-green-600 font-bold">{completed}</td>
                                        <td className="px-6 py-4 text-yellow-600 font-bold">{user.pending_count}</td>
                                        <td className="px-6 py-4">
                                            <div className="w-full bg-gray-200 rounded-full h-2.5">
                                                <div
                                                    className="bg-blue-600 h-2.5 rounded-full"
                                                    style={{ width: `${percentage}%` }}
                                                ></div>
                                            </div>
                                            <span className="text-xs text-gray-500 mt-1 block">{percentage}%</span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detailed List */}
            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-800">Detailed Assignments</h2>
                </div>
                <div className="p-6 max-h-[600px] overflow-y-auto">
                    {details.map((row, idx) => (
                        <div key={idx} className="flex justify-between items-center py-2 border-b last:border-0 border-gray-100">
                            <div>
                                <span className={`inline-block w-20 text-xs font-bold px-2 py-1 rounded mr-3 ${row.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                    {row.status}
                                </span>
                                <span className="text-gray-800 text-sm font-medium mr-2">
                                    [{row.language}] {row.paper_name}
                                </span>
                            </div>
                            <span className="text-gray-400 text-xs">{row.email}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
