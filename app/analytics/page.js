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

    // 4. Reviewer paper-level + question-level progress
    const reviewerPaperRes = await client.query(`
        SELECT
            u.id AS user_id,
            u.name,
            u.email,
            COUNT(*) AS total_assigned,
            COUNT(*) FILTER (WHERE ps.status IN ('TEAM_REVIEWED', 'ADMIN_REVIEWED', 'MISSING_ADDED', 'PRE_PUBLISH_READY', 'SOLUTION_REVIEW', 'PRODUCTION')) AS reviewed,
            COUNT(*) FILTER (WHERE ps.status = 'NOT_REVIEWED') AS pending,
            COALESCE(SUM(qv_s.total_q), 0) AS total_questions,
            COALESCE(SUM(qv_s.corrected_q), 0) AS corrected_questions,
            COALESCE(SUM(qv_s.flagged_q), 0) AS flagged_questions
        FROM review_assignments ra
        JOIN users u ON ra.reviewer_id = u.id
        JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
        LEFT JOIN (
            SELECT paper_session_id,
                   COUNT(*) AS total_q,
                   COUNT(*) FILTER (WHERE status = 'MANUALLY_CORRECTED') AS corrected_q,
                   COUNT(*) FILTER (WHERE status = 'FLAGGED') AS flagged_q
            FROM question_version
            GROUP BY paper_session_id
        ) qv_s ON qv_s.paper_session_id = ra.paper_session_id
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

    // 5b. Exam-wise pipeline metrics (split by language)
    const examPipelineRes = await client.query(`
        SELECT
            COALESCE(e.name, 'Unknown') AS exam_name,
            qv.language,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE qv.status = 'MANUALLY_CORRECTED') AS corrected,
            COUNT(*) FILTER (WHERE qv.solution_status = 'DONE') AS solutions_done,
            COUNT(*) FILTER (WHERE ps.status = 'PRODUCTION') AS production
        FROM question_version qv
        JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
        LEFT JOIN exam e ON ps.exam_id = e.exam_id
        GROUP BY e.name, qv.language
        ORDER BY e.name, qv.language
    `);

    // Pivot: group by exam, nest EN/HI as sub-rows
    const examPipelineMap = {};
    for (const row of examPipelineRes.rows) {
        const key = row.exam_name;
        if (!examPipelineMap[key]) examPipelineMap[key] = { exam_name: key, langs: {} };
        examPipelineMap[key].langs[row.language] = {
            total: parseInt(row.total),
            corrected: parseInt(row.corrected),
            solutions_done: parseInt(row.solutions_done),
            production: parseInt(row.production),
        };
    }
    const examPipelineData = Object.values(examPipelineMap);

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

    // 6. Daily progress history (last 30 days)
    const dailyProgressRes = await client.query(`
        SELECT
            edp.snapshot_date,
            u.name,
            u.email,
            edp.corrected_questions,
            edp.flagged_questions,
            edp.papers_reviewed
        FROM editor_daily_progress edp
        JOIN users u ON u.id = edp.user_id
        WHERE edp.snapshot_date >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY edp.snapshot_date DESC, u.name
    `);

    // Build daily delta: compare each day to the previous day per user
    const dailyRows = dailyProgressRes.rows;
    const userDays = {}; // { email: { date: { corrected, flagged, papers_reviewed } } }
    for (const r of dailyRows) {
        const dateStr = new Date(r.snapshot_date).toISOString().slice(0, 10);
        if (!userDays[r.email]) userDays[r.email] = {};
        userDays[r.email][dateStr] = {
            name: r.name,
            corrected: parseInt(r.corrected_questions),
            flagged: parseInt(r.flagged_questions),
            papers_reviewed: parseInt(r.papers_reviewed),
        };
    }

    // Get unique sorted dates (newest first)
    const allDates = [...new Set(dailyRows.map(r => new Date(r.snapshot_date).toISOString().slice(0, 10)))].sort().reverse();
    const allEditors = [...new Set(dailyRows.map(r => r.email))].sort();

    // Compute daily deltas
    const dailyDeltas = []; // [{ date, editor, name, corrected_delta, flagged_delta, papers_delta }]
    for (const email of allEditors) {
        const days = userDays[email];
        for (let i = 0; i < allDates.length; i++) {
            const date = allDates[i];
            const prev = allDates[i + 1];
            const cur = days[date];
            if (!cur) continue;
            const prevData = prev ? days[prev] : null;
            dailyDeltas.push({
                date,
                editor: email,
                name: cur.name,
                corrected_delta: prevData ? cur.corrected - prevData.corrected : cur.corrected,
                flagged_delta: prevData ? cur.flagged - prevData.flagged : 0,
                papers_delta: prevData ? cur.papers_reviewed - prevData.papers_reviewed : 0,
                corrected_total: cur.corrected,
            });
        }
    }

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

            {/* Exam-wise Pipeline Metrics */}
            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden mb-12">
                <div className="px-6 py-4 border-b border-gray-200 bg-emerald-50">
                    <h2 className="text-lg font-bold text-gray-800">Exam-wise Question Pipeline</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                            <tr>
                                <th className="px-5 py-3">Exam</th>
                                <th className="px-3 py-3 text-center">Lang</th>
                                <th className="px-3 py-3 text-center">Total</th>
                                <th className="px-3 py-3 text-center">Corrected</th>
                                <th className="px-3 py-3 text-center">Solutions</th>
                                <th className="px-3 py-3 text-center">Production</th>
                                <th className="px-3 py-3 text-center">Pipeline</th>
                            </tr>
                        </thead>
                        <tbody>
                            {examPipelineData.map((exam) => {
                                const langs = Object.entries(exam.langs);
                                const examTotal = langs.reduce((s, [, v]) => s + v.total, 0);
                                const examCorrected = langs.reduce((s, [, v]) => s + v.corrected, 0);
                                const examSolutions = langs.reduce((s, [, v]) => s + v.solutions_done, 0);
                                const examProduction = langs.reduce((s, [, v]) => s + v.production, 0);

                                return langs.map(([lang, d], i) => (
                                    <tr key={`${exam.exam_name}-${lang}`} className={`border-b hover:bg-gray-50 ${i === 0 ? 'border-t-2 border-gray-200' : ''}`}>
                                        {i === 0 && (
                                            <td className="px-5 py-3 font-bold text-gray-900 align-top" rowSpan={langs.length + 1}>
                                                {exam.exam_name}
                                            </td>
                                        )}
                                        <td className="px-3 py-2 text-center">
                                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${lang === 'EN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}`}>
                                                {lang}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-center font-medium">{d.total}</td>
                                        <td className="px-3 py-2 text-center">
                                            <span className="font-bold text-green-600">{d.corrected}</span>
                                            <span className="text-gray-400 text-xs ml-1">({d.total > 0 ? Math.round(d.corrected / d.total * 100) : 0}%)</span>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <span className="font-bold text-indigo-600">{d.solutions_done}</span>
                                            <span className="text-gray-400 text-xs ml-1">({d.total > 0 ? Math.round(d.solutions_done / d.total * 100) : 0}%)</span>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <span className={`font-bold ${d.production > 0 ? 'text-purple-600' : 'text-gray-300'}`}>{d.production}</span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex gap-0.5 h-2 rounded-full overflow-hidden bg-gray-200 min-w-[100px]">
                                                {d.production > 0 && <div className="bg-purple-500" style={{ width: `${d.production / d.total * 100}%` }} title="Production" />}
                                                {d.solutions_done - d.production > 0 && <div className="bg-indigo-400" style={{ width: `${(d.solutions_done - d.production) / d.total * 100}%` }} title="Solutions Done" />}
                                                {d.corrected - d.solutions_done > 0 && <div className="bg-green-400" style={{ width: `${(d.corrected - d.solutions_done) / d.total * 100}%` }} title="Corrected" />}
                                            </div>
                                        </td>
                                    </tr>
                                )).concat(
                                    <tr key={`${exam.exam_name}-total`} className="bg-gray-50/50 border-b">
                                        <td className="px-3 py-1.5 text-center text-xs font-bold text-gray-500">ALL</td>
                                        <td className="px-3 py-1.5 text-center font-bold text-gray-700">{examTotal}</td>
                                        <td className="px-3 py-1.5 text-center font-bold text-green-700">{examCorrected}</td>
                                        <td className="px-3 py-1.5 text-center font-bold text-indigo-700">{examSolutions}</td>
                                        <td className="px-3 py-1.5 text-center font-bold text-purple-700">{examProduction}</td>
                                        <td className="px-3 py-1.5"></td>
                                    </tr>
                                );
                            })}
                            {/* Grand total */}
                            <tr className="bg-gray-100 border-t-2 border-gray-400 font-bold">
                                <td className="px-5 py-3 text-gray-800">Grand Total</td>
                                <td className="px-3 py-3"></td>
                                <td className="px-3 py-3 text-center">{examPipelineData.reduce((s, e) => s + Object.values(e.langs).reduce((ss, v) => ss + v.total, 0), 0)}</td>
                                <td className="px-3 py-3 text-center text-green-700">{examPipelineData.reduce((s, e) => s + Object.values(e.langs).reduce((ss, v) => ss + v.corrected, 0), 0)}</td>
                                <td className="px-3 py-3 text-center text-indigo-700">{examPipelineData.reduce((s, e) => s + Object.values(e.langs).reduce((ss, v) => ss + v.solutions_done, 0), 0)}</td>
                                <td className="px-3 py-3 text-center text-purple-700">{examPipelineData.reduce((s, e) => s + Object.values(e.langs).reduce((ss, v) => ss + v.production, 0), 0)}</td>
                                <td className="px-3 py-3"></td>
                            </tr>
                        </tbody>
                    </table>
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
                    <h2 className="text-lg font-bold text-gray-800">Reviewer Paper & Question Progress</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                            <tr>
                                <th className="px-4 py-3" rowSpan={2}>Reviewer</th>
                                <th className="px-3 py-2 text-center border-b" colSpan={3}>Papers</th>
                                <th className="px-3 py-2 text-center border-b" colSpan={4}>Questions</th>
                            </tr>
                            <tr>
                                <th className="px-3 py-2 text-center">Assigned</th>
                                <th className="px-3 py-2 text-center">Reviewed</th>
                                <th className="px-3 py-2 text-center">Pending</th>
                                <th className="px-3 py-2 text-center">Total</th>
                                <th className="px-3 py-2 text-center">Corrected</th>
                                <th className="px-3 py-2 text-center">Flagged</th>
                                <th className="px-3 py-2 text-center">Q Progress</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reviewerPaperRes.rows.map((r) => {
                                const total = parseInt(r.total_assigned);
                                const reviewed = parseInt(r.reviewed);
                                const pending = parseInt(r.pending);
                                const totalQ = parseInt(r.total_questions);
                                const correctedQ = parseInt(r.corrected_questions);
                                const flaggedQ = parseInt(r.flagged_questions);
                                const qPct = totalQ > 0 ? Math.round((correctedQ / totalQ) * 100) : 0;
                                return (
                                    <tr key={r.user_id} className="bg-white border-b hover:bg-gray-50">
                                        <td className="px-4 py-3 font-medium text-gray-900">
                                            {r.name}
                                            <div className="text-xs text-gray-400 font-normal">{r.email}</div>
                                        </td>
                                        <td className="px-3 py-3 text-center font-bold">{total}</td>
                                        <td className="px-3 py-3 text-center font-bold text-green-600">{reviewed}</td>
                                        <td className="px-3 py-3 text-center font-bold text-red-600">{pending}</td>
                                        <td className="px-3 py-3 text-center">{totalQ}</td>
                                        <td className="px-3 py-3 text-center font-bold text-green-600">{correctedQ}</td>
                                        <td className="px-3 py-3 text-center font-bold text-orange-600">{flaggedQ}</td>
                                        <td className="px-3 py-3">
                                            <div className="w-full bg-gray-200 rounded-full h-2">
                                                <div className={`h-2 rounded-full ${qPct === 100 ? 'bg-green-500' : 'bg-blue-600'}`}
                                                    style={{ width: `${qPct}%` }}></div>
                                            </div>
                                            <span className="text-xs text-gray-500 mt-0.5 block text-center">{correctedQ}/{totalQ} ({qPct}%)</span>
                                        </td>
                                    </tr>
                                );
                            })}
                            <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                                <td className="px-4 py-3 text-gray-800">Total</td>
                                <td className="px-3 py-3 text-center">{reviewerPaperRes.rows.reduce((s, r) => s + parseInt(r.total_assigned), 0)}</td>
                                <td className="px-3 py-3 text-center text-green-600">{reviewerPaperRes.rows.reduce((s, r) => s + parseInt(r.reviewed), 0)}</td>
                                <td className="px-3 py-3 text-center text-red-600">{reviewerPaperRes.rows.reduce((s, r) => s + parseInt(r.pending), 0)}</td>
                                <td className="px-3 py-3 text-center">{reviewerPaperRes.rows.reduce((s, r) => s + parseInt(r.total_questions), 0)}</td>
                                <td className="px-3 py-3 text-center text-green-600">{reviewerPaperRes.rows.reduce((s, r) => s + parseInt(r.corrected_questions), 0)}</td>
                                <td className="px-3 py-3 text-center text-orange-600">{reviewerPaperRes.rows.reduce((s, r) => s + parseInt(r.flagged_questions), 0)}</td>
                                <td className="px-3 py-3"></td>
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

            {/* Daily Editor Progress */}
            {allDates.length > 0 && (
                <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden mb-12">
                    <div className="px-6 py-4 border-b border-gray-200 bg-indigo-50">
                        <h2 className="text-lg font-bold text-gray-800">Daily Editor Progress (Last 30 Days)</h2>
                        <p className="text-xs text-gray-500 mt-1">Shows questions corrected per day per editor (delta from previous snapshot)</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-500">
                            <thead className="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 sticky left-0 bg-gray-50 z-10">Date</th>
                                    {allEditors.map(email => {
                                        const name = userDays[email]?.[allDates[0]]?.name || email.split('@')[0];
                                        return (
                                            <th key={email} className="px-4 py-3 text-center whitespace-nowrap">
                                                {name}
                                            </th>
                                        );
                                    })}
                                    <th className="px-4 py-3 text-center font-bold">Team Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allDates.map(date => {
                                    const dayDeltas = dailyDeltas.filter(d => d.date === date);
                                    const teamTotal = dayDeltas.reduce((s, d) => s + d.corrected_delta, 0);
                                    const isToday = date === new Date().toISOString().slice(0, 10);
                                    const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });

                                    return (
                                        <tr key={date} className={`border-b hover:bg-gray-50 ${isToday ? 'bg-indigo-50/50' : 'bg-white'}`}>
                                            <td className={`px-4 py-3 font-medium whitespace-nowrap sticky left-0 ${isToday ? 'bg-indigo-50 text-indigo-700 font-bold' : 'bg-white text-gray-900'}`}>
                                                {dateLabel}
                                            </td>
                                            {allEditors.map(email => {
                                                const delta = dayDeltas.find(d => d.editor === email);
                                                const val = delta?.corrected_delta || 0;
                                                const flagVal = delta?.flagged_delta || 0;
                                                return (
                                                    <td key={email} className="px-4 py-3 text-center">
                                                        {val > 0 ? (
                                                            <span className="font-bold text-green-600">+{val}</span>
                                                        ) : val === 0 ? (
                                                            <span className="text-gray-300">-</span>
                                                        ) : (
                                                            <span className="text-red-500">{val}</span>
                                                        )}
                                                        {flagVal > 0 && (
                                                            <span className="text-orange-500 text-xs ml-1">({flagVal}f)</span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className="px-4 py-3 text-center font-bold">
                                                {teamTotal > 0 ? (
                                                    <span className="text-green-700">+{teamTotal}</span>
                                                ) : (
                                                    <span className="text-gray-400">0</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {/* Cumulative total row */}
                                <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                                    <td className="px-4 py-3 sticky left-0 bg-gray-50 text-gray-800">30-Day Total</td>
                                    {allEditors.map(email => {
                                        const total = dailyDeltas
                                            .filter(d => d.editor === email)
                                            .reduce((s, d) => s + d.corrected_delta, 0);
                                        return (
                                            <td key={email} className="px-4 py-3 text-center text-green-700">
                                                {total > 0 ? `+${total}` : total}
                                            </td>
                                        );
                                    })}
                                    <td className="px-4 py-3 text-center text-green-700">
                                        +{dailyDeltas.reduce((s, d) => s + d.corrected_delta, 0)}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Detailed List */}
            <DetailedAssignmentsTable details={details} />
        </div>
    );
}
