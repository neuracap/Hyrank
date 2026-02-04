import db from '@/lib/db';
import { requireAdmin } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
    // 1. Authenticate & Authorize
    await requireAdmin();

    const client = await db.connect();

    // 2. Fetch Aggregated Stats (Granular: based on Question Links)
    // We use a CTE to find distinct matching links per reviewer to avoid double counting 
    // the same link if both EN and HI papers are assigned to the same person.
    const statsRes = await client.query(`
        WITH reviewer_links AS (
            SELECT DISTINCT
                ra.reviewer_id,
                ql.id as link_id,
                ql.status
            FROM review_assignments ra
            JOIN question_links ql ON (
                ql.paper_session_id_english = ra.paper_session_id
                OR ql.paper_session_id_hindi = ra.paper_session_id
            )
        )
        SELECT 
            u.id as user_id,
            u.name,
            u.email,
            COUNT(DISTINCT ra.id) as papers_assigned,
            COALESCE(rl_stats.total_q, 0) as total_questions,
            COALESCE(rl_stats.corrected_q, 0) as corrected_questions
        FROM users u
        JOIN review_assignments ra ON ra.reviewer_id = u.id
        LEFT JOIN (
            SELECT 
                reviewer_id,
                COUNT(link_id) as total_q,
                COUNT(CASE WHEN status = 'MANUALLY_CORRECTED' THEN 1 END) as corrected_q
            FROM reviewer_links
            GROUP BY reviewer_id
        ) rl_stats ON u.id = rl_stats.reviewer_id
        GROUP BY u.id, u.name, u.email, rl_stats.total_q, rl_stats.corrected_q
        ORDER BY corrected_questions DESC, u.name
    `);

    // 3. Detailed List with Per-Paper Progress
    // Note: We compute progress for the *pair* this paper belongs to.
    const detailedRes = await client.query(`
        SELECT 
            u.email,
            ps.paper_session_id,
            ps.caption as paper_name,
            ps.language,
            ra.status as assignment_status,
            ra.assigned_at,
            (
                SELECT COUNT(*) 
                FROM question_links ql 
                WHERE ql.paper_session_id_english = ps.paper_session_id 
                   OR ql.paper_session_id_hindi = ps.paper_session_id
            ) as paper_total_q,
            (
                SELECT COUNT(*) 
                FROM question_links ql 
                WHERE (ql.paper_session_id_english = ps.paper_session_id 
                   OR ql.paper_session_id_hindi = ps.paper_session_id)
                   AND ql.status = 'MANUALLY_CORRECTED'
            ) as paper_corrected_q
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
                    <h3 className="text-sm font-bold text-gray-500 uppercase">Total Questions to Review</h3>
                    <p className="text-4xl font-bold text-blue-600 mt-2">
                        {stats.reduce((acc, curr) => acc + parseInt(curr.total_questions), 0)}
                    </p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
                    <h3 className="text-sm font-bold text-gray-500 uppercase">Total Corrected</h3>
                    <p className="text-4xl font-bold text-green-600 mt-2">
                        {stats.reduce((acc, curr) => acc + parseInt(curr.corrected_questions), 0)}
                    </p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
                    <h3 className="text-sm font-bold text-gray-500 uppercase">Overall Progress</h3>
                    <p className="text-4xl font-bold text-purple-600 mt-2">
                        {(() => {
                            const total = stats.reduce((acc, curr) => acc + parseInt(curr.total_questions), 0);
                            const corrected = stats.reduce((acc, curr) => acc + parseInt(curr.corrected_questions), 0);
                            return total > 0 ? Math.round((corrected / total) * 100) + '%' : '0%';
                        })()}
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
                                <th className="px-6 py-3">Paper Sets</th>
                                <th className="px-6 py-3">Questions (Total)</th>
                                <th className="px-6 py-3">Corrected</th>
                                <th className="px-6 py-3">Progress</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.map((user) => {
                                const total = parseInt(user.total_questions);
                                const corrected = parseInt(user.corrected_questions);
                                const percentage = total > 0 ? Math.round((corrected / total) * 100) : 0;
                                const papersCount = parseInt(user.papers_assigned);

                                return (
                                    <tr key={user.user_id} className="bg-white border-b hover:bg-gray-50">
                                        <td className="px-6 py-4 font-medium text-gray-900">
                                            {user.name} <br />
                                            <span className="text-gray-400 font-normal text-xs">{user.email}</span>
                                        </td>
                                        <td className="px-6 py-4">{papersCount / 2} pairs ({papersCount})</td>
                                        <td className="px-6 py-4">{total}</td>
                                        <td className="px-6 py-4 text-green-600 font-bold">{corrected}</td>
                                        <td className="px-6 py-4">
                                            <div className="w-full bg-gray-200 rounded-full h-2.5">
                                                <div
                                                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                                                    style={{ width: `${percentage}%` }}
                                                ></div>
                                            </div>
                                            <span className="text-xs text-gray-500 mt-1 block">{corrected}/{total} ({percentage}%)</span>
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
                    {details.map((row, idx) => {
                        const pTotal = parseInt(row.paper_total_q);
                        const pCorrected = parseInt(row.paper_corrected_q);
                        const pPercent = pTotal > 0 ? Math.round((pCorrected / pTotal) * 100) : 0;

                        return (
                            <div key={idx} className="flex flex-col sm:flex-row justify-between items-start sm:items-center py-3 border-b last:border-0 border-gray-100">
                                <div className="mb-2 sm:mb-0">
                                    <div className="flex items-center mb-1">
                                        <span className={`inline-block w-20 text-xs font-bold px-2 py-1 rounded mr-3 text-center ${row.assignment_status === 'COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                                            {row.assignment_status === 'COMPLETED' ? 'DONE' : 'ACTIVE'}
                                        </span>
                                        <span className={`text-xs font-bold px-2 py-[2px] rounded mr-2 border ${row.language === 'EN' ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-orange-200 text-orange-600 bg-orange-50'}`}>
                                            {row.language}
                                        </span>
                                        <span className="text-gray-800 text-sm font-medium truncat max-w-[300px] sm:max-w-md" title={row.paper_name}>
                                            {row.paper_name}
                                        </span>
                                    </div>
                                    <div className="ml-[100px] text-xs text-gray-400">
                                        Assigned to: {row.email}
                                    </div>
                                </div>

                                <div className="flex items-center w-full sm:w-auto ml-[100px] sm:ml-0">
                                    <div className="w-32 mr-3">
                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                            <div
                                                className="bg-green-500 h-2 rounded-full transition-all duration-500"
                                                style={{ width: `${pPercent}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                    <span className="text-sm font-medium text-gray-600 min-w-[80px] text-right">
                                        {pCorrected} / {pTotal}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
