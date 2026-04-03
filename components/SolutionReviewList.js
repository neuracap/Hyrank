'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

const STATUS_COLORS = {
    'NOT_REVIEWED': 'bg-gray-100 text-gray-500',
    'TEAM_REVIEWED': 'bg-purple-100 text-purple-700',
    'ADMIN_REVIEWED': 'bg-indigo-100 text-indigo-700',
    'MISSING_ADDED': 'bg-blue-100 text-blue-700',
    'PRE_PUBLISH_READY': 'bg-teal-100 text-teal-700',
    'SOLUTION_REVIEW': 'bg-orange-100 text-orange-700',
    'PRODUCTION': 'bg-green-100 text-green-700',
    'NOT_WORTHY': 'bg-red-100 text-red-700',
};

export default function SolutionReviewList({ papers, exams, examFilter, statusFilter, currentPage, totalPages, total }) {
    const router = useRouter();

    const buildUrl = (overrides = {}) => {
        const params = new URLSearchParams();
        const exam = overrides.exam !== undefined ? overrides.exam : examFilter;
        const status = overrides.status !== undefined ? overrides.status : statusFilter;
        const page = overrides.page || 1;
        if (exam !== 'ALL') params.set('exam', exam);
        if (status !== 'ALL') params.set('status', status);
        if (page > 1) params.set('page', page);
        return `/solution-review?${params.toString()}`;
    };

    return (
        <div className="container mx-auto px-4 py-8">
            <header className="mb-6">
                <h1 className="text-3xl font-bold text-gray-900">Solution Review</h1>
                <p className="text-gray-500 mt-1">Papers with 80%+ questions solved — {total} papers</p>
            </header>

            {/* Filters */}
            <div className="bg-white border border-gray-200 rounded-lg px-6 py-4 mb-6 flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <label className="text-sm font-semibold text-gray-700">Exam:</label>
                    <select value={examFilter} onChange={e => router.push(buildUrl({ exam: e.target.value }))}
                        className="text-sm border-gray-300 rounded-md px-3 py-1.5">
                        <option value="ALL">All Exams</option>
                        {exams.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-sm font-semibold text-gray-700">Status:</label>
                    <select value={statusFilter} onChange={e => router.push(buildUrl({ status: e.target.value }))}
                        className="text-sm border-gray-300 rounded-md px-3 py-1.5">
                        <option value="ALL">All Statuses</option>
                        {Object.keys(STATUS_COLORS).map(s => (
                            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                        ))}
                    </select>
                </div>
                {(examFilter !== 'ALL' || statusFilter !== 'ALL') && (
                    <button onClick={() => router.push('/solution-review')}
                        className="text-sm text-gray-500 hover:text-red-600 font-medium">
                        Clear Filters
                    </button>
                )}
            </div>

            {/* Papers Table */}
            <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
                {papers.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">No papers found matching the criteria.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-500">
                            <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3">Date</th>
                                    <th className="px-4 py-3">Exam</th>
                                    <th className="px-4 py-3">Paper</th>
                                    <th className="px-4 py-3">Lang</th>
                                    <th className="px-4 py-3">Total</th>
                                    <th className="px-4 py-3">Solved</th>
                                    <th className="px-4 py-3">Images</th>
                                    <th className="px-4 py-3">Linked</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {papers.map(p => {
                                    const totalQ = parseInt(p.total_q);
                                    const solvedQ = parseInt(p.solved_q);
                                    const imageQ = parseInt(p.image_q);
                                    const pct = totalQ > 0 ? Math.round((solvedQ / totalQ) * 100) : 0;
                                    return (
                                        <tr key={p.paper_session_id} className="bg-white border-b hover:bg-gray-50">
                                            <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-600">
                                                {p.paper_date ? new Date(p.paper_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{p.exam_name || '—'}</span>
                                            </td>
                                            <td className="px-4 py-3 font-medium text-gray-900 text-xs max-w-[250px] truncate" title={p.session_label}>
                                                {p.session_label}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${p.language === 'EN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}`}>
                                                    {p.language}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 font-bold text-xs">{totalQ}</td>
                                            <td className="px-4 py-3 text-xs">
                                                <span className="font-bold text-green-600">{solvedQ}</span>
                                                <span className="text-gray-400 ml-1">({pct}%)</span>
                                            </td>
                                            <td className="px-4 py-3 text-xs">
                                                {imageQ > 0 ? (
                                                    <span className="font-bold text-amber-600">{imageQ}</span>
                                                ) : (
                                                    <span className="text-gray-300">0</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-xs">
                                                {p.is_linked ? (
                                                    <span className="text-green-600 font-bold">Yes</span>
                                                ) : (
                                                    <span className="text-gray-400">No</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[p.pipeline_status] || 'bg-gray-100 text-gray-600'}`}>
                                                    {(p.pipeline_status || 'UNKNOWN').replace(/_/g, ' ')}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col gap-1">
                                                    <Link href={`/solution-review?paperId=${p.paper_session_id}&lang=${p.language}`}
                                                        className="px-3 py-1 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700 text-center">
                                                        Solution Review
                                                    </Link>
                                                    {p.is_linked && p.language === 'EN' && (
                                                        <Link href={`/solution-review-bilingual?auto=${p.paper_session_id}`}
                                                            className="px-3 py-1 bg-purple-50 text-purple-600 text-xs font-bold rounded border border-purple-200 hover:bg-purple-100 text-center">
                                                            Bilingual
                                                        </Link>
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

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                        <span className="text-sm text-gray-500">
                            Page {currentPage} of {totalPages} ({total} papers)
                        </span>
                        <div className="flex gap-2">
                            {currentPage > 1 && (
                                <Link href={buildUrl({ page: currentPage - 1 })}
                                    className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50">Previous</Link>
                            )}
                            {currentPage < totalPages && (
                                <Link href={buildUrl({ page: currentPage + 1 })}
                                    className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50">Next</Link>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
