import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import BulkReclassifyButton from '@/components/BulkReclassifyButton';
import SyncVerifiedButton from '@/components/SyncVerifiedButton';
import DashboardFilters from '@/components/DashboardFilters';
import StatusSelector from '@/components/StatusSelector';

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

    // Anything below this line can fail with a DB error (Supabase cold
    // start, pool exhausted, transient network). Capture failures and
    // render a clear retry UI — do NOT redirect to /login, which used
    // to falsely suggest the session was broken.
    let client = null;
    let dbErrorMsg = null;
    try {
        client = await db.connect();
    } catch (dbErr) {
        console.error('Dashboard DB connect error:', dbErr);
        dbErrorMsg = dbErr?.message || String(dbErr);
    }

    let availableSubjects = [];
    if (client && !dbErrorMsg) {
        try {
            // 2. Fetch distinct subjects for the filter dropdown
            const subjectsRes = await client.query(`SELECT DISTINCT subject FROM paper_session WHERE subject IS NOT NULL ORDER BY subject ASC`);
            availableSubjects = subjectsRes.rows.map(row => row.subject);
        } catch (e) {
            console.error('Dashboard subjects query error:', e);
            dbErrorMsg = e?.message || String(e);
        }
    }

    if (dbErrorMsg) {
        client?.release?.();
        return (
            <div className="container mx-auto px-4 py-12 max-w-2xl">
                <div className="bg-white border border-red-200 rounded-lg p-6">
                    <div className="flex items-start gap-3 mb-3">
                        <div className="text-red-600 text-2xl">⚠</div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">Database unreachable</h1>
                            <p className="text-sm text-gray-600 mt-1">
                                You ARE signed in (your session is valid), but the dashboard couldn't reach the
                                database. This is usually a transient Supabase cold-start or pool blip —
                                refreshing in a few seconds normally fixes it.
                            </p>
                        </div>
                    </div>
                    <pre className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 overflow-x-auto whitespace-pre-wrap">{dbErrorMsg}</pre>
                    <div className="mt-4 flex gap-2">
                        <a href="/dashboard" className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded hover:bg-blue-700">
                            Retry
                        </a>
                        <a href="/mock-tests" className="px-4 py-2 border border-gray-300 text-sm font-semibold rounded hover:bg-gray-50">
                            Go to Mock Tests
                        </a>
                    </div>
                </div>
            </div>
        );
    }

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

    // Refactored to dodge the Supabase 15s statement_timeout that the
    // previous single-query version hit on cold-start: the original
    // correlated subqueries scanned question_version + question_links
    // (~26k rows) once per row × 50 rows × 3 metrics. Now:
    //   (1) lightweight base query — just paper_session fields + the
    //       LEFT JOINs to review_assignments / users.
    //   (2) the 50 paper_session_ids feed 2 batched COUNT queries that
    //       each scan once with WHERE = ANY($ids) — fast even cold.
    //   (3) merge in JS.
    //
    // Schema note: question_links has BOTH paper_session_id_english and
    // paper_session_id_hindi. A paper_session can appear on either side.
    // We sum both via UNION ALL so the count matches the previous OR-join
    // semantics exactly.
    try {
    let baseRows = [];
    if (user.isAdmin) {
        // --- ADMIN ---
        if (status !== 'ALL') {
            whereConditions.push(`ps.status = $${paramIndex}`);
            queryParams.push(status);
            paramIndex++;
        }
        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        const countRes = await client.query(
            `SELECT COUNT(*) FROM paper_session ps ${whereClause}`,
            queryParams
        );
        totalCount = parseInt(countRes.rows[0].count, 10);

        const res = await client.query(`
            SELECT
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.caption,
                ps.subject,
                ps.language,
                ps.status AS pipeline_status,
                ru.email AS reviewer_email
            FROM paper_session ps
            LEFT JOIN review_assignments ra ON ps.paper_session_id = ra.paper_session_id
            LEFT JOIN users ru ON ra.reviewer_id = ru.id
            ${whereClause}
            ORDER BY ps.paper_date DESC NULLS LAST
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, [...queryParams, limit, offset]);
        baseRows = res.rows;
    } else {
        // --- REVIEWER ---
        whereConditions.push(`ra.reviewer_id = $${paramIndex}`);
        queryParams.push(user.id);
        paramIndex++;

        whereConditions.push(`ps.language = 'EN'`);
        whereConditions.push(`EXISTS (
            SELECT 1 FROM question_links ql
            WHERE ql.paper_session_id_english = ps.paper_session_id
               OR ql.paper_session_id_hindi   = ps.paper_session_id
        )`);

        if (status !== 'ALL') {
            whereConditions.push(`ps.status = $${paramIndex}`);
            queryParams.push(status);
            paramIndex++;
        }

        const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
        const countRes = await client.query(`
            SELECT COUNT(*)
            FROM review_assignments ra
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
            ${whereClause}
        `, queryParams);
        totalCount = parseInt(countRes.rows[0].count, 10);

        const res = await client.query(`
            SELECT
                ps.paper_session_id,
                ps.session_label,
                ps.paper_date,
                ps.caption,
                ps.subject,
                ps.language,
                ps.status AS pipeline_status,
                ra.status AS assignment_status
            FROM review_assignments ra
            JOIN paper_session ps ON ra.paper_session_id = ps.paper_session_id
            ${whereClause}
            ORDER BY ra.assigned_at DESC, ps.paper_date DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, [...queryParams, limit, offset]);
        baseRows = res.rows;
    }

    // Now enrich baseRows with the 3 counts, scoped to just the page's IDs.
    const pageIds = baseRows.map(r => r.paper_session_id);
    let qvCounts = {};
    let linkCounts = {};   // { [paper_session_id]: { MANUALLY_CORRECTED: n, FLAGGED: m } }

    // Sequential, not Promise.all — a pg Client serializes queries
    // anyway (no real parallelism on one connection), and PgBouncer
    // transaction mode gets confused when we pipeline.
    if (pageIds.length > 0) {
        const qvRes = await client.query(`
            SELECT paper_session_id, COUNT(*)::int AS c
            FROM question_version
            WHERE paper_session_id = ANY($1)
            GROUP BY paper_session_id
        `, [pageIds]);

        const linkRes = await client.query(`
            SELECT psid AS paper_session_id, status, COUNT(*)::int AS c
            FROM (
                SELECT paper_session_id_english AS psid, status FROM question_links
                WHERE paper_session_id_english = ANY($1) AND status IN ('MANUALLY_CORRECTED', 'FLAGGED')
                UNION ALL
                SELECT paper_session_id_hindi, status FROM question_links
                WHERE paper_session_id_hindi   = ANY($1) AND status IN ('MANUALLY_CORRECTED', 'FLAGGED')
            ) AS x
            GROUP BY psid, status
        `, [pageIds]);

        for (const r of qvRes.rows) qvCounts[r.paper_session_id] = r.c;
        for (const r of linkRes.rows) {
            if (!linkCounts[r.paper_session_id]) linkCounts[r.paper_session_id] = {};
            linkCounts[r.paper_session_id][r.status] = r.c;
        }
    }

    papers = baseRows.map(r => ({
        ...r,
        total_q:         qvCounts[r.paper_session_id]                            ?? 0,
        corrected_count: linkCounts[r.paper_session_id]?.MANUALLY_CORRECTED ?? 0,
        flagged_count:   linkCounts[r.paper_session_id]?.FLAGGED           ?? 0,
    }));
    } catch (queryErr) {
        console.error('Dashboard data-fetch error:', queryErr);
        client?.release?.();
        return (
            <div className="container mx-auto px-4 py-12 max-w-2xl">
                <div className="bg-white border border-red-200 rounded-lg p-6">
                    <div className="flex items-start gap-3 mb-3">
                        <div className="text-red-600 text-2xl">⚠</div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">Dashboard query failed</h1>
                            <p className="text-sm text-gray-600 mt-1">
                                Your session is valid — the database connection succeeded, but one of the
                                dashboard queries errored out. This is usually transient (Supabase pool /
                                idle disconnect). Refresh in a few seconds.
                            </p>
                        </div>
                    </div>
                    <pre className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 overflow-x-auto whitespace-pre-wrap">{queryErr?.message || String(queryErr)}</pre>
                    <div className="mt-4 flex gap-2">
                        <a href="/dashboard" className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded hover:bg-blue-700">
                            Retry
                        </a>
                        <a href="/mock-tests" className="px-4 py-2 border border-gray-300 text-sm font-semibold rounded hover:bg-gray-50">
                            Go to Mock Tests
                        </a>
                    </div>
                </div>
            </div>
        );
    }

    client?.release();

    const totalPages = Math.ceil(totalCount / limit);

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
                    <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
                    <p className="text-gray-500 mt-1">
                        Welcome back, {user.name} ({user.isAdmin ? 'Admin' : 'Reviewer'})
                    </p>
                </div>
                {user.isAdmin && (
                    <div className="flex gap-4 items-center flex-wrap">
                        <BulkReclassifyButton />
                        <SyncVerifiedButton />
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
                                    {user.isAdmin && <th className="px-6 py-3">Assigned To</th>}
                                    <th className="px-6 py-3">Questions</th>
                                    <th className="px-6 py-3">Corrected</th>
                                    <th className="px-6 py-3">Flagged</th>
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
                                            {user.isAdmin && (
                                                <td className="px-6 py-4 font-medium text-gray-900">
                                                    {paper.reviewer_email ? (
                                                        <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded">
                                                            {paper.reviewer_email.split('@')[0]}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400 italic">Unassigned</span>
                                                    )}
                                                </td>
                                            )}
                                            <td className="px-6 py-4">
                                                <span className="font-bold text-gray-900 bg-gray-100 px-2 py-1 rounded">
                                                    {parseInt(paper.total_q || 0)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`font-bold px-2 py-1 rounded ${parseInt(paper.corrected_count || 0) === parseInt(paper.total_q || 0) && parseInt(paper.total_q || 0) > 0
                                                    ? 'bg-green-100 text-green-800' // all corrected!
                                                    : parseInt(paper.corrected_count || 0) > 0
                                                        ? 'bg-blue-100 text-blue-800' // partially corrected
                                                        : 'bg-gray-100 text-gray-500' // none corrected
                                                    }`}>
                                                    {parseInt(paper.corrected_count || 0)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                {parseInt(paper.flagged_count || 0) > 0 ? (
                                                    <span className="font-bold px-2 py-1 rounded bg-orange-100 text-orange-700">
                                                        🚩 {parseInt(paper.flagged_count)}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-300 text-xs">—</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {user.isAdmin ? (
                                                    <StatusSelector
                                                        paperSessionId={paper.paper_session_id}
                                                        currentStatus={paper.pipeline_status}
                                                    />
                                                ) : (
                                                    getStatusPill(paper.pipeline_status)
                                                )}
                                                {!user.isAdmin && (
                                                    <div className="mt-2 text-xs">
                                                        My Task: <span className={`font-semibold ${paper.assignment_status === 'COMPLETED' ? 'text-green-600' : 'text-yellow-600'}`}>{paper.assignment_status}</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex justify-end gap-2">
                                                    {paper.language === 'EN' ? (
                                                        <Link
                                                            href={`/bilingual/${paper.paper_session_id}`}
                                                            prefetch={false}
                                                            className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700 transition-colors shadow-sm"
                                                        >
                                                            Review Paper
                                                        </Link>
                                                    ) : (
                                                        <span className="px-4 py-1.5 bg-gray-100 text-gray-400 text-xs font-bold rounded cursor-not-allowed" title="Open the English paper to review bilingual pairs">
                                                            Use EN Paper
                                                        </span>
                                                    )}
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
