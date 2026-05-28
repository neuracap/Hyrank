'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Latex from '@/components/Latex';

const SOURCE_META = {
    manual_verified_correct: { label: 'Manual verified', color: 'bg-purple-100 text-purple-700 border-purple-300' },
    auto_text_match: { label: 'Auto text match', color: 'bg-blue-100 text-blue-700 border-blue-300' },
    auto_resolved: { label: 'Auto resolved', color: 'bg-gray-100 text-gray-600 border-gray-300' },
};

const VIEWS = [
    { key: 'pending', label: 'Pending' },
    { key: 'resolved', label: 'Resolved' },
    { key: 'needs_expert', label: 'Needs expert' },
    { key: 'all', label: 'All' },
];

const LIMIT = 50;

export default function AnswerConflicts() {
    const [stats, setStats] = useState(null);
    const [section, setSection] = useState('ALL');
    const [pdfSource, setPdfSource] = useState('ALL');
    const [view, setView] = useState('pending');

    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [idx, setIdx] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [verdict, setVerdict] = useState(null);
    const [showSolution, setShowSolution] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    // local override of resolved verdicts so the focused card reflects submits immediately
    const [localResolved, setLocalResolved] = useState({});

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch('/api/answer-conflicts/stats');
            const data = await res.json();
            if (res.ok && data.success) setStats(data);
        } catch (e) {
            console.error('stats fetch failed', e);
        }
    }, []);

    const fetchList = useCallback(async (targetPage = 1) => {
        setLoading(true);
        setError('');
        try {
            const qs = new URLSearchParams({
                section, pdf_source: pdfSource, view,
                page: String(targetPage), limit: String(LIMIT),
            });
            const res = await fetch(`/api/answer-conflicts?${qs}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load');
            if (targetPage === 1) {
                setRows(data.rows);
                setIdx(0);
            } else {
                setRows(prev => [...prev, ...data.rows]);
            }
            setTotal(data.total);
            setPage(targetPage);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [section, pdfSource, view]);

    useEffect(() => { fetchStats(); }, [fetchStats]);
    useEffect(() => {
        setLocalResolved({});
        fetchList(1);
    }, [fetchList]);

    // reset per-question controls when the focused item changes
    useEffect(() => { setVerdict(null); setShowSolution(false); }, [idx, rows]);

    const current = rows[idx] || null;

    const advance = async () => {
        const nextIdx = idx + 1;
        if (nextIdx < rows.length) {
            setIdx(nextIdx);
        } else if (rows.length < total) {
            await fetchList(page + 1);
            setIdx(nextIdx);
        }
        // else: end of queue, stay
    };

    const submitVerdict = async (chosen) => {
        if (!current || submitting) return;
        setSubmitting(true);
        try {
            const res = await fetch('/api/answer-conflicts/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: current.question_id,
                    version_no: current.version_no,
                    verdict: chosen,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Submit failed');
            const key = `${current.question_id}:${current.version_no}`;
            setLocalResolved(prev => ({
                ...prev,
                [key]: {
                    final_correct_option_label: data.final_correct_option_label,
                    final_answer_source: data.final_answer_source,
                },
            }));
            fetchStats();
            await advance();
        } catch (e) {
            setError(e.message);
        } finally {
            setSubmitting(false);
        }
    };

    const resolvedKey = current ? `${current.question_id}:${current.version_no}` : null;
    const existingVerdict = current
        ? (localResolved[resolvedKey] || (
            current.final_answer_source
                ? { final_correct_option_label: current.final_correct_option_label, final_answer_source: current.final_answer_source }
                : null))
        : null;

    const overall = stats?.overall;
    const pct = overall && overall.total ? Math.round((overall.resolved / overall.total) * 100) : 0;

    return (
        <div className="container mx-auto px-4 py-6 max-w-5xl">
            <header className="mb-5 flex items-center justify-between border-b pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Answer-Key Conflict Resolver</h1>
                    <p className="text-gray-500 text-sm mt-0.5">
                        Solver answer vs SSC answer-key disagree — adjudicate each. Verdicts are stored on
                        question_version (not promoted to is_correct yet).
                    </p>
                </div>
                <Link href="/dashboard" className="text-blue-600 hover:text-blue-800 text-sm font-medium whitespace-nowrap">← Dashboard</Link>
            </header>

            {/* Progress */}
            {overall && (
                <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-bold text-gray-700">
                            {overall.resolved} of {overall.total} resolved
                            <span className="text-gray-400 font-normal"> · {overall.needs_expert} needs expert · {overall.pending} pending</span>
                        </span>
                        <span className="text-sm font-bold text-gray-700">{pct}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                        {stats.by_section.map(s => (
                            <span key={s.section_code} className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50 text-gray-600">
                                <span className="font-semibold text-gray-800">{s.section_code}</span> {s.resolved}/{s.total}
                                {s.needs_expert > 0 && <span className="text-amber-600"> ·{s.needs_expert}⚑</span>}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase">Section</label>
                    <select value={section} onChange={e => setSection(e.target.value)}
                        className="text-sm border border-gray-300 rounded px-2 py-1">
                        <option value="ALL">All</option>
                        {(stats?.by_section || []).map(s => (
                            <option key={s.section_code} value={s.section_code}>{s.section_code} ({s.total})</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase">Source</label>
                    <select value={pdfSource} onChange={e => setPdfSource(e.target.value)}
                        className="text-sm border border-gray-300 rounded px-2 py-1">
                        <option value="ALL">All</option>
                        {(stats?.by_source || []).map(s => (
                            <option key={s.pdf_source} value={s.pdf_source}>
                                {(SOURCE_META[s.pdf_source]?.label || s.pdf_source)} ({s.total})
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-1 ml-auto">
                    {VIEWS.map(v => (
                        <button key={v.key} onClick={() => setView(v.key)}
                            className={`text-xs font-semibold px-2.5 py-1 rounded ${view === v.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            {v.label}
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>
            )}

            {/* Queue position */}
            {!loading && rows.length > 0 && (
                <div className="flex items-center justify-between mb-3 text-sm">
                    <span className="text-gray-500">
                        Item <span className="font-bold text-gray-800">{idx + 1}</span> of {total} in this view
                    </span>
                    <div className="flex gap-2">
                        <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
                            className="px-3 py-1 text-sm border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-40">← Prev</button>
                        <button onClick={advance} disabled={idx + 1 >= total}
                            className="px-3 py-1 text-sm border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-40">Skip →</button>
                    </div>
                </div>
            )}

            {loading && rows.length === 0 && <div className="p-8 text-center text-gray-400">Loading…</div>}
            {!loading && rows.length === 0 && (
                <div className="p-8 text-center text-gray-500 bg-white rounded-lg border border-gray-200">
                    No conflicts in this view. 🎉
                </div>
            )}

            {current && (
                <ConflictCard
                    key={`${current.question_id}:${current.version_no}`}
                    item={current}
                    verdict={verdict}
                    setVerdict={setVerdict}
                    showSolution={showSolution}
                    setShowSolution={setShowSolution}
                    submitting={submitting}
                    onSubmit={submitVerdict}
                    existingVerdict={existingVerdict}
                />
            )}
        </div>
    );
}

function AnswerBadge({ label, value, tone }) {
    const tones = {
        blue: 'bg-blue-50 border-blue-300 text-blue-800',
        amber: 'bg-amber-50 border-amber-300 text-amber-800',
    };
    return (
        <div className={`flex-1 rounded-lg border px-4 py-3 ${tones[tone]}`}>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
            <div className="text-2xl font-bold mt-0.5">{value || '—'}</div>
        </div>
    );
}

function ConflictCard({ item, verdict, setVerdict, showSolution, setShowSolution, submitting, onSubmit, existingVerdict }) {
    const options = item.options || {};
    const sol = item.solution_text || null;
    const srcMeta = SOURCE_META[item.pdf_source] || { label: item.pdf_source, color: 'bg-gray-100 text-gray-600 border-gray-300' };
    const stem = item.question_stem?.text || '';

    const displaySections = Array.isArray(sol?.display_sections) ? sol.display_sections : [];
    const coreBasis = sol?.answer_outcome?.core_answer_basis;
    const figureUrl = sol?.answer_outcome?.figure_url;

    return (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center gap-2 text-xs">
                {item.section_code && <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-semibold">{item.section_code}</span>}
                {item.exam_code && <span className="text-gray-600 font-semibold">{item.exam_code}</span>}
                {item.tier && <span className="text-gray-500">{item.tier}</span>}
                {item.paper_date && <span className="text-gray-500">{new Date(item.paper_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                {item.shift_label && <span className="text-gray-500">{item.shift_label}</span>}
                <span className="text-gray-500">Q.{item.source_question_no || item.question_number || '—'}</span>
                <span className={`px-2 py-0.5 rounded border font-semibold ${srcMeta.color}`}>{srcMeta.label}</span>
                {existingVerdict && (
                    <span className="px-2 py-0.5 rounded bg-green-100 text-green-700 font-semibold">
                        {existingVerdict.final_answer_source === 'needs_expert'
                            ? 'Marked: needs expert'
                            : `Resolved: ${existingVerdict.final_correct_option_label} (${(existingVerdict.final_answer_source || '').replace('conflict_resolved_', '')})`}
                    </span>
                )}
                {item.source_pdf_path && (
                    <a href={`/api/pdf?path=${encodeURIComponent(item.source_pdf_path)}`} target="_blank" rel="noopener noreferrer"
                        className="ml-auto px-2 py-0.5 rounded border border-blue-300 text-blue-700 bg-white hover:bg-blue-50 font-semibold">
                        Open answer-key PDF ↗
                    </a>
                )}
                <span className="font-mono text-gray-300 w-full">{item.question_id}</span>
            </div>

            {/* The disagreement */}
            <div className="px-5 pt-4 flex gap-3">
                <AnswerBadge label="Solution says" value={item.solution_answer} tone="blue" />
                <AnswerBadge label="Answer key says" value={item.answer_key_answer} tone="amber" />
            </div>

            {/* Stem */}
            <div className="px-5 pt-4">
                <div className="bg-gray-50 border border-gray-100 rounded-md p-4">
                    <Latex>{stem}</Latex>
                </div>
            </div>

            {/* Options — pick the final answer */}
            <div className="px-5 pt-4">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                    Pick the correct option
                </h3>
                <div className="space-y-2">
                    {Object.entries(options).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => {
                        const isSolution = item.solution_answer === key;
                        const isAnswerKey = item.answer_key_answer === key;
                        const isPicked = verdict === key;
                        return (
                            <button key={key} type="button" onClick={() => setVerdict(key)}
                                className={`w-full flex gap-3 p-3 rounded-md border text-left transition-colors
                                    ${isPicked ? 'border-green-500 ring-2 ring-green-300 bg-green-50'
                                        : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                                <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border
                                    ${isPicked ? 'bg-green-500 text-white border-green-500' : 'bg-gray-50 text-gray-700 border-gray-300'}`}>
                                    {key}
                                </div>
                                <div className="flex-1 text-sm text-gray-700 pt-0.5">
                                    <Latex>{val?.text || ''}</Latex>
                                </div>
                                <div className="flex flex-col gap-1 items-end">
                                    {isSolution && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 whitespace-nowrap">SOLUTION</span>}
                                    {isAnswerKey && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 whitespace-nowrap">ANSWER KEY</span>}
                                </div>
                            </button>
                        );
                    })}
                    {Object.keys(options).length === 0 && (
                        <div className="text-sm text-gray-400 italic">No options found.</div>
                    )}
                </div>
            </div>

            {/* Worked solution (expandable, shown regardless of solution_status) */}
            <div className="px-5 pt-4">
                <button onClick={() => setShowSolution(s => !s)}
                    className="text-sm font-semibold text-gray-600 hover:text-gray-900 flex items-center gap-1">
                    {showSolution ? '▾' : '▸'} Worked solution
                    <span className="text-xs font-normal text-gray-400">({item.solution_status || 'no status'})</span>
                </button>
                {showSolution && (
                    <div className="mt-2 p-4 bg-slate-50 border border-slate-200 rounded-md text-sm text-gray-700">
                        {!sol && <div className="text-gray-400 italic">No solver reasoning available — verify against the answer-key PDF.</div>}
                        {coreBasis && (
                            <div className="mb-3">
                                <div className="text-xs font-bold text-gray-500 uppercase mb-0.5">Core basis</div>
                                <Latex>{coreBasis}</Latex>
                            </div>
                        )}
                        {displaySections.map((sec, i) => (
                            <div key={i} className="mb-3">
                                <div className="text-xs font-bold text-gray-500 uppercase mb-0.5">{(sec.key || '').replace(/_/g, ' ')}</div>
                                <Latex>{sec.content || ''}</Latex>
                            </div>
                        ))}
                        {figureUrl && (
                            <div className="mt-2">
                                <div className="text-xs font-bold text-gray-500 uppercase mb-1">Figure</div>
                                <img src={figureUrl} alt="Solution figure" className="max-h-64 rounded border border-gray-300 object-contain" />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Verdict actions */}
            <div className="px-5 py-4 mt-4 border-t border-gray-100 bg-gray-50 flex items-center gap-3">
                <button
                    onClick={() => onSubmit(verdict)}
                    disabled={!verdict || submitting}
                    className="px-5 py-2 rounded-md bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed">
                    {submitting ? 'Saving…' : verdict ? `Confirm answer: ${verdict}` : 'Pick an option first'}
                </button>
                <button
                    onClick={() => onSubmit('needs_expert')}
                    disabled={submitting}
                    className="px-4 py-2 rounded-md border border-amber-400 text-amber-700 bg-white text-sm font-semibold hover:bg-amber-50 disabled:opacity-40">
                    Still unsure / needs expert
                </button>
                <span className="ml-auto text-xs text-gray-400">Verdict is saved, not yet promoted to is_correct.</span>
            </div>
        </div>
    );
}
