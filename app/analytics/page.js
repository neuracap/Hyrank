import db from '@/lib/db';
import { requireAdmin } from '@/lib/auth-edge';
import DetailedAssignmentsTable from '@/components/DetailedAssignmentsTable';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
    // 1. Authenticate & Authorize
    await requireAdmin();

    const client = await db.connect();

    // 2. Fetch Aggregated Stats — count directly from question_version (not question_links)
    const statsRes = await client.query(`
        SELECT
            u.id as user_id,
            u.name,
            u.email,
            COUNT(DISTINCT ra.id) as papers_assigned,
            COALESCE(SUM(qv_stats.total_q), 0) as total_questions,
            COALESCE(SUM(qv_stats.corrected_q), 0) as corrected_questions,
            COALESCE(SUM(qv_stats.flagged_q), 0) as flagged_questions
        FROM users u
        JOIN review_assignments ra ON ra.reviewer_id = u.id
        LEFT JOIN (
            SELECT
                paper_session_id,
                COUNT(*) as total_q,
                COUNT(*) FILTER (WHERE status = 'MANUALLY_CORRECTED') as corrected_q,
                COUNT(*) FILTER (WHERE status = 'FLAGGED') as flagged_q
            FROM question_version
            GROUP BY paper_session_id
        ) qv_stats ON qv_stats.paper_session_id = ra.paper_session_id
        GROUP BY u.id, u.name, u.email
        ORDER BY corrected_questions DESC, u.name
    `);

    // 3. Detailed List with Per-Paper Progress — count from question_version directly
    const detailedRes = await client.query(`
        SELECT
            u.email,
            ps.paper_session_id,
            ps.caption as paper_name,
            ps.language,
            EXTRACT(YEAR FROM ps.paper_date) as paper_year,
            ra.status as assignment_status,
            ra.assigned_at,
            (
                SELECT COUNT(*)
                FROM question_version qv
                WHERE qv.paper_session_id = ps.paper_session_id
            ) as paper_total_q,
            (
                SELECT COUNT(*)
                FROM question_version qv
                WHERE qv.paper_session_id = ps.paper_session_id
                  AND qv.status = 'MANUALLY_CORRECTED'
            ) as paper_corrected_q
        FROM review_assignments ra
        JOIN users u ON ra.reviewer_id = u.id
        JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
        ORDER BY u.email, ra.status, ps.language
    `);

    // 4. Reviewer paper-level progress (assigned vs team_reviewed vs pending)
    const reviewerPaperRes = await client.query(`
        SELECT
            u.id AS user_id,
            u.name,
            u.email,
            COUNT(*) AS total_assigned,
            COUNT(*) FILTER (WHERE ps.status IN ('TEAM_REVIEWED', 'ADMIN_REVIEWED', 'MISSING_ADDED', 'PRE_PUBLISH_READY', 'SOLUTION_REVIEW', 'PRODUCTION')) AS reviewed,
            COUNT(*) FILTER (WHERE ps.status = 'NOT_REVIEWED') AS pending
        FROM review_assignments ra
        JOIN users u ON ra.reviewer_id = u.id
        JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
        GROUP BY u.id, u.name, u.email
        ORDER BY pending DESC, u.name
    `);

    // 5. Exam-Year-Language breakdown
    const examYearRes = await client.query(`
        SELECT
            e.name AS exam_name,
            EXTRACT(YEAR FROM ps.paper_date)::INTEGER AS paper_year,
            qv.language,
            COUNT(*) AS total_questions,
            COUNT(*) FILTER (WHERE qv.status = 'MANUALLY_CORRECTED') AS corrected_questions
        FROM question_version qv
        JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
        LEFT JOIN exam e ON ps.exam_id = e.exam_id
        WHERE e.name IS NOT NULL AND ps.paper_date IS NOT NULL
        GROUP BY e.name, paper_year, qv.language
        ORDER BY e.name ASC, paper_year DESC, qv.language ASC
    `);

    // 5. Unallotted papers — not in review_assignments, grouped by exam
    const unallottedRes = await client.query(`
        SELECT
            COALESCE(e.name, 'Unknown') AS exam_name,
            ps.language,
            ps.status AS pipeline_status,
            COUNT(*) AS paper_count
        FROM paper_session ps
        LEFT JOIN exam e ON e.exam_id = ps.exam_id
        WHERE NOT EXISTS (
            SELECT 1 FROM review_assignments ra WHERE ra.paper_session_id = ps.paper_session_id
        )
        AND ps.status NOT IN ('NOT_WORTHY')
        GROUP BY e.name, ps.language, ps.status
        ORDER BY e.name, ps.language, ps.status
    `);

    // Build unallotted grouped: { examName: { language: { status: count } } }
    const unallottedMap = {};
    let totalUnallotted = 0;
    for (const row of unallottedRes.rows) {
        if (!unallottedMap[row.exam_name]) unallottedMap[row.exam_name] = {};
        if (!unallottedMap[row.exam_name][row.language]) unallottedMap[row.exam_name][row.language] = {};
        const cnt = parseInt(row.paper_count);
        unallottedMap[row.exam_name][row.language][row.pipeline_status] = cnt;
        totalUnallotted += cnt;
    }

    client.release();

    const stats = statsRes.rows;
    const details = detailedRes.rows;
    const examYearData = examYearRes.rows;

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
                                <th className="px-6 py-3">Flagged</th>
                                <th className="px-6 py-3">Progress</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.map((user) => {
                                const total = parseInt(user.total_questions);
                                const corrected = parseInt(user.corrected_questions);
                                const flagged = parseInt(user.flagged_questions);
                                const percentage = total > 0 ? Math.round((corrected / total) * 100) : 0;
                                const flaggedPct = corrected > 0 ? Math.round((flagged / corrected) * 100) : 0;
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
                                            <span className="font-bold text-orange-600">{flagged}</span>
                                            {corrected > 0 && (
                                                <span className="text-xs text-gray-400 ml-1">({flaggedPct}%)</span>
                                            )}
                                        </td>
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

            {/* Reviewer Paper Progress */}
            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden mb-12">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-800">Reviewer Paper Progress</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                            <tr>
                                <th className="px-6 py-3">Reviewer</th>
                                <th className="px-6 py-3">Total Assigned</th>
                                <th className="px-6 py-3">Reviewed</th>
                                <th className="px-6 py-3">Pending</th>
                                <th className="px-6 py-3">Progress</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reviewerPaperRes.rows.map((r) => {
                                const total = parseInt(r.total_assigned);
                                const reviewed = parseInt(r.reviewed);
                                const pending = parseInt(r.pending);
                                const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
                                return (
                                    <tr key={r.user_id} className="bg-white border-b hover:bg-gray-50">
                                        <td className="px-6 py-3 font-medium text-gray-900">
                                            {r.name}
                                            <div className="text-xs text-gray-400 font-normal">{r.email}</div>
                                        </td>
                                        <td className="px-6 py-3 font-bold">{total}</td>
                                        <td className="px-6 py-3 font-bold text-green-600">{reviewed}</td>
                                        <td className="px-6 py-3 font-bold text-red-600">{pending}</td>
                                        <td className="px-6 py-3">
                                            <div className="w-full bg-gray-200 rounded-full h-2.5">
                                                <div className={`h-2.5 rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-blue-600'}`}
                                                    style={{ width: `${pct}%` }}></div>
                                            </div>
                                            <span className="text-xs text-gray-500 mt-1 block">{reviewed}/{total} ({pct}%)</span>
                                        </td>
                                    </tr>
                                );
                            })}
                            <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                                <td className="px-6 py-3 text-gray-800">Total</td>
                                <td className="px-6 py-3">{reviewerPaperRes.rows.reduce((s, r) => s + parseInt(r.total_assigned), 0)}</td>
                                <td className="px-6 py-3 text-green-600">{reviewerPaperRes.rows.reduce((s, r) => s + parseInt(r.reviewed), 0)}</td>
                                <td className="px-6 py-3 text-red-600">{reviewerPaperRes.rows.reduce((s, r) => s + parseInt(r.pending), 0)}</td>
                                <td className="px-6 py-3"></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Unallotted Papers */}
            {totalUnallotted > 0 && (
                <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden mb-12">
                    <div className="px-6 py-4 border-b border-gray-200 bg-amber-50">
                        <h2 className="text-lg font-bold text-gray-800">
                            Unallotted Papers
                            <span className="ml-2 text-sm font-normal text-gray-500">({totalUnallotted} papers not assigned to any reviewer)</span>
                        </h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-500">
                            <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3">Exam</th>
                                    <th className="px-6 py-3">Language</th>
                                    <th className="px-6 py-3">Status</th>
                                    <th className="px-6 py-3">Papers</th>
                                </tr>
                            </thead>
                            <tbody>
                                {unallottedRes.rows.map((row, idx) => (
                                    <tr key={idx} className="bg-white border-b hover:bg-gray-50">
                                        <td className="px-6 py-3 font-medium text-gray-900">{row.exam_name}</td>
                                        <td className="px-6 py-3">
                                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${row.language === 'EN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}`}>
                                                {row.language || '?'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                                {(row.pipeline_status || 'UNKNOWN').replace(/_/g, ' ')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 font-bold text-amber-600">{parseInt(row.paper_count)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Exam-Year-Language Breakdown */}
            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden mb-12">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <h2 className="text-lg font-bold text-gray-800">Questions by Exam, Year & Language</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                            <tr>
                                <th className="px-6 py-3">Exam</th>
                                <th className="px-6 py-3">Year</th>
                                <th className="px-6 py-3">Language</th>
                                <th className="px-6 py-3">Total Questions</th>
                                <th className="px-6 py-3">Corrected</th>
                                <th className="px-6 py-3">Pending</th>
                                <th className="px-6 py-3">Progress</th>
                            </tr>
                        </thead>
                        <tbody>
                            {examYearData.map((row, idx) => {
                                const total = parseInt(row.total_questions);
                                const corrected = parseInt(row.corrected_questions);
                                const pending = total - corrected;
                                const pct = total > 0 ? Math.round((corrected / total) * 100) : 0;

                                return (
                                    <tr key={idx} className="bg-white border-b hover:bg-gray-50">
                                        <td className="px-6 py-3 font-medium text-gray-900">{row.exam_name}</td>
                                        <td className="px-6 py-3">{row.paper_year || '—'}</td>
                                        <td className="px-6 py-3">
                                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${row.language === 'EN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}`}>
                                                {row.language}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 font-bold">{total}</td>
                                        <td className="px-6 py-3 text-green-600 font-bold">{corrected}</td>
                                        <td className="px-6 py-3">
                                            {pending > 0 ? (
                                                <span className="text-red-600 font-bold">{pending}</span>
                                            ) : (
                                                <span className="text-green-500 font-bold">0</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-24 bg-gray-200 rounded-full h-2">
                                                    <div
                                                        className={`h-2 rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                                                        style={{ width: `${pct}%` }}
                                                    ></div>
                                                </div>
                                                <span className="text-xs text-gray-500">{pct}%</span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detailed List */}
            <DetailedAssignmentsTable details={details} />
        </div>
    );
}
