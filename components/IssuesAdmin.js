'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Latex from '@/components/Latex';

// Friendly labels + colors for common issue_type slugs the student app sends.
// Anything not in this map renders the raw slug.
const TYPE_META = {
    wrong_answer_key:    { label: 'Wrong answer key',  color: 'bg-red-100 text-red-700' },
    unclear_or_typo:     { label: 'Unclear / typo',    color: 'bg-amber-100 text-amber-800' },
    solution_wrong:      { label: 'Solution wrong',    color: 'bg-orange-100 text-orange-700' },
    image_broken:        { label: 'Image broken',      color: 'bg-purple-100 text-purple-700' },
    something_else:      { label: 'Something else',    color: 'bg-gray-100 text-gray-700' },
};
const typeLabel = (t) => TYPE_META[t]?.label || t || '—';
const typeColor = (t) => TYPE_META[t]?.color || 'bg-gray-100 text-gray-600';

const STATUS_META = {
    open:      { label: 'Open',      color: 'bg-blue-100 text-blue-700' },
    resolved:  { label: 'Resolved',  color: 'bg-green-100 text-green-700' },
    dismissed: { label: 'Dismissed', color: 'bg-gray-200 text-gray-600' },
};

const STATUS_OPTIONS = [
    { key: 'open',      label: 'Open' },
    { key: 'resolved',  label: 'Resolved' },
    { key: 'dismissed', label: 'Dismissed' },
    { key: 'all',       label: 'All' },
];

function timeAgo(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return 'just now';
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(iso).toLocaleDateString('en-IN');
}

export default function IssuesAdmin() {
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [counts, setCounts] = useState({ status: {}, issue_type: {} });
    const [loading, setLoading] = useState(false);
    const [statusFilter, setStatusFilter] = useState('open');
    const [typeFilter, setTypeFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [expanded, setExpanded] = useState({});
    const [busyId, setBusyId] = useState(null);
    const [notesDraft, setNotesDraft] = useState({});
    const [feedback, setFeedback] = useState(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const qs = new URLSearchParams({
                status: statusFilter,
                issue_type: typeFilter,
                ...(search ? { q: search } : {}),
                limit: '100',
            });
            const res = await fetch(`/api/issues/list?${qs.toString()}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Load failed');
            setRows(data.rows || []);
            setTotal(data.total || 0);
            setCounts(data.counts || { status: {}, issue_type: {} });
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setLoading(false);
        }
    }, [statusFilter, typeFilter, search]);

    useEffect(() => { reload(); }, [reload]);

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        setSearch(searchInput.trim());
    };

    const update = async (issue, patch) => {
        setBusyId(issue.id);
        try {
            const res = await fetch(`/api/issues/${issue.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Update failed');
            setFeedback({ type: 'success', msg: 'Saved' });
            await reload();
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setBusyId(null);
            setTimeout(() => setFeedback(null), 2000);
        }
    };

    const typeKeys = Object.keys(counts.issue_type || {}).sort();

    return (
        <div>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Student Issue Reports</h1>
                    <p className="text-sm text-gray-500">
                        Flagged by students from the exam and analysis screens.
                        {' '}
                        <span className="text-blue-700 font-semibold">{counts.status?.open || 0} open</span>
                        {' · '}
                        <span className="text-green-700">{counts.status?.resolved || 0} resolved</span>
                        {' · '}
                        <span className="text-gray-500">{counts.status?.dismissed || 0} dismissed</span>
                    </p>
                </div>
                {feedback && (
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${
                        feedback.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                        {feedback.msg}
                    </span>
                )}
            </div>

            {/* Status pills */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className="text-xs text-gray-500 mr-1 w-14">Status:</span>
                {STATUS_OPTIONS.map(opt => {
                    const count = opt.key === 'all'
                        ? Object.values(counts.status || {}).reduce((a, b) => a + b, 0)
                        : (counts.status?.[opt.key] || 0);
                    const active = statusFilter === opt.key;
                    return (
                        <button
                            key={opt.key}
                            onClick={() => setStatusFilter(opt.key)}
                            className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${
                                active
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                            }`}
                        >
                            {opt.label} <span className={`ml-1 ${active ? 'text-blue-100' : 'text-gray-400'}`}>{count}</span>
                        </button>
                    );
                })}
            </div>

            {/* Type pills */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className="text-xs text-gray-500 mr-1 w-14">Type:</span>
                <button
                    onClick={() => setTypeFilter('all')}
                    className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${
                        typeFilter === 'all'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                    }`}
                >
                    All <span className={`ml-1 ${typeFilter === 'all' ? 'text-blue-100' : 'text-gray-400'}`}>
                        {Object.values(counts.issue_type || {}).reduce((a, b) => a + b, 0)}
                    </span>
                </button>
                {typeKeys.map(k => {
                    const active = typeFilter === k;
                    return (
                        <button
                            key={k}
                            onClick={() => setTypeFilter(k)}
                            className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${
                                active
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                            }`}
                        >
                            {typeLabel(k)} <span className={`ml-1 ${active ? 'text-blue-100' : 'text-gray-400'}`}>
                                {counts.issue_type?.[k] || 0}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Search */}
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 mb-5">
                <input
                    type="text"
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    placeholder="Search description, notes, or question text…"
                    className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400"
                />
                <button type="submit"
                    className="px-3 py-1.5 text-xs font-semibold bg-gray-800 text-white rounded hover:bg-gray-900">
                    Search
                </button>
                {search && (
                    <button type="button" onClick={() => { setSearchInput(''); setSearch(''); }}
                        className="px-3 py-1.5 text-xs font-semibold border border-gray-300 text-gray-600 bg-white rounded hover:bg-gray-50">
                        Clear
                    </button>
                )}
            </form>

            {loading && (
                <div className="text-center py-12 text-sm text-gray-400">Loading…</div>
            )}
            {!loading && rows.length === 0 && (
                <div className="text-center py-12 text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg">
                    No issues match these filters.
                </div>
            )}
            {!loading && rows.length > 0 && (
                <div className="text-xs text-gray-500 mb-2">
                    Showing {rows.length} of {total}
                </div>
            )}

            <div className="space-y-3">
                {rows.map(r => {
                    const isOpen = !!expanded[r.id];
                    const statusInfo = STATUS_META[r.status] || { label: r.status, color: 'bg-gray-100 text-gray-600' };
                    return (
                        <div key={r.id} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                            <button
                                type="button"
                                onClick={() => setExpanded(s => ({ ...s, [r.id]: !s[r.id] }))}
                                className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-gray-50"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap text-xs">
                                        <span className={`font-semibold px-2 py-0.5 rounded-full ${statusInfo.color}`}>
                                            {statusInfo.label}
                                        </span>
                                        <span className={`font-semibold px-2 py-0.5 rounded ${typeColor(r.issue_type)}`}>
                                            {typeLabel(r.issue_type)}
                                        </span>
                                        {r.subtype && (
                                            <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-mono">
                                                {r.subtype}
                                            </span>
                                        )}
                                        {r.exam_code && (
                                            <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                                                {r.exam_code}
                                            </span>
                                        )}
                                        <span className="font-mono text-gray-400">{(r.question_id || '').slice(0, 8)}</span>
                                        <span className="text-gray-400">·</span>
                                        <span className="text-gray-500">{timeAgo(r.created_at)}</span>
                                    </div>
                                    <div className="mt-1 text-sm text-gray-800 line-clamp-2">
                                        {r.description
                                            ? <span className="italic text-gray-700">&ldquo;{r.description}&rdquo;</span>
                                            : <span className="text-gray-400">(no description)</span>}
                                    </div>
                                </div>
                                <span className="text-gray-400 text-sm">{isOpen ? '▾' : '▸'}</span>
                            </button>

                            {isOpen && (
                                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-3">
                                    <div>
                                        <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">Question preview</div>
                                        <div className="text-sm text-gray-800 bg-white border border-gray-200 rounded p-3">
                                            {r.question_preview
                                                ? <Latex>{r.question_preview}</Latex>
                                                : <span className="text-gray-400 italic">No EN version found for this question_id</span>}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                                        <div><span className="text-gray-500">question_id:</span> <span className="font-mono">{r.question_id}</span></div>
                                        {r.version_no != null && <div><span className="text-gray-500">version:</span> {r.version_no}</div>}
                                        {r.language && <div><span className="text-gray-500">language:</span> {r.language}</div>}
                                        {r.correct_option_label && <div><span className="text-gray-500">answer key:</span> {r.correct_option_label}</div>}
                                        {r.context && <div><span className="text-gray-500">context:</span> {r.context}</div>}
                                        {r.session_id && <div className="truncate"><span className="text-gray-500">session_id:</span> <span className="font-mono">{r.session_id}</span></div>}
                                        {r.attempt_id && <div className="truncate"><span className="text-gray-500">attempt:</span> <span className="font-mono">{(r.attempt_id || '').slice(0, 8)}</span></div>}
                                        <div><span className="text-gray-500">reporter:</span> <span className="font-mono">{(r.user_id || '').slice(0, 8)}</span></div>
                                    </div>

                                    {r.resolution_notes && (
                                        <div className="text-xs">
                                            <span className="text-gray-500">resolution notes:</span>
                                            <div className="mt-1 p-2 bg-white border border-gray-200 rounded text-gray-700 whitespace-pre-wrap">
                                                {r.resolution_notes}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Link
                                            href={`/question/${r.question_id}`}
                                            className="px-3 py-1 text-xs font-semibold border border-blue-300 text-blue-700 bg-white rounded hover:bg-blue-50"
                                        >
                                            Open question editor →
                                        </Link>
                                        <div className="ml-auto" />
                                    </div>

                                    <div className="border-t border-gray-200 pt-3">
                                        <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">
                                            Resolution notes (optional)
                                        </div>
                                        <textarea
                                            value={notesDraft[r.id] ?? r.resolution_notes ?? ''}
                                            onChange={e => setNotesDraft(d => ({ ...d, [r.id]: e.target.value }))}
                                            rows={2}
                                            placeholder="What was changed, or why this was dismissed…"
                                            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5"
                                        />
                                        <div className="flex items-center justify-end gap-2 mt-2">
                                            {r.status !== 'open' && (
                                                <button
                                                    onClick={() => update(r, { status: 'open', resolution_notes: notesDraft[r.id] ?? r.resolution_notes ?? '' })}
                                                    disabled={busyId === r.id}
                                                    className="px-3 py-1 text-xs font-semibold border border-blue-300 text-blue-700 bg-white rounded hover:bg-blue-50 disabled:opacity-50"
                                                >
                                                    Reopen
                                                </button>
                                            )}
                                            {r.status !== 'dismissed' && (
                                                <button
                                                    onClick={() => update(r, { status: 'dismissed', resolution_notes: notesDraft[r.id] ?? r.resolution_notes ?? '' })}
                                                    disabled={busyId === r.id}
                                                    className="px-3 py-1 text-xs font-semibold border border-gray-300 text-gray-700 bg-white rounded hover:bg-gray-50 disabled:opacity-50"
                                                >
                                                    Dismiss
                                                </button>
                                            )}
                                            {r.status !== 'resolved' && (
                                                <button
                                                    onClick={() => update(r, { status: 'resolved', resolution_notes: notesDraft[r.id] ?? r.resolution_notes ?? '' })}
                                                    disabled={busyId === r.id}
                                                    className="px-3 py-1 text-xs font-semibold bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                                                >
                                                    {busyId === r.id ? 'Saving…' : 'Mark resolved'}
                                                </button>
                                            )}
                                            {r.status !== 'open' && r.resolved_at && (
                                                <span className="text-[10px] text-gray-400 ml-2">
                                                    {r.status} {timeAgo(r.resolved_at)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
