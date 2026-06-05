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
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Per-card staging of the picked option before Confirm.
    // Keyed by `${qid}:${version_no}` so 50 cards can each hold their own.
    const [verdicts, setVerdicts] = useState({});
    // Which row is currently being submitted (only one at a time prevents races).
    const [submittingKey, setSubmittingKey] = useState(null);
    // local override of resolved verdicts so cards reflect submits immediately
    const [localResolved, setLocalResolved] = useState({});
    // per-question local override of solution_json after an edit, keyed `${qid}:${ver}`
    const [solutionOverrides, setSolutionOverrides] = useState({});

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
        setVerdicts({});
        fetchList(1);
    }, [fetchList]);

    const onSolutionSaved = (qid, ver, nextSolutionJson) => {
        setSolutionOverrides(prev => ({ ...prev, [`${qid}:${ver}`]: nextSolutionJson }));
    };

    const submitVerdict = async (item, chosen) => {
        if (!item || submittingKey) return;
        const key = `${item.question_id}:${item.version_no}`;
        setSubmittingKey(key);
        try {
            const res = await fetch('/api/answer-conflicts/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: item.question_id,
                    version_no: item.version_no,
                    verdict: chosen,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Submit failed');
            setLocalResolved(prev => ({
                ...prev,
                [key]: {
                    final_correct_option_label: data.final_correct_option_label,
                    final_answer_source: data.final_answer_source,
                },
            }));
            fetchStats();
        } catch (e) {
            setError(e.message);
        } finally {
            setSubmittingKey(null);
        }
    };

    const existingVerdictFor = (item) => {
        const key = `${item.question_id}:${item.version_no}`;
        return localResolved[key]
            || (item.final_answer_source
                ? { final_correct_option_label: item.final_correct_option_label, final_answer_source: item.final_answer_source }
                : null);
    };

    const hasMore = rows.length < total;

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

            {/* Queue header */}
            {!loading && rows.length > 0 && (
                <div className="flex items-center justify-between mb-3 text-sm">
                    <span className="text-gray-500">
                        Showing <span className="font-bold text-gray-800">{rows.length}</span> of {total} in this view
                    </span>
                </div>
            )}

            {loading && rows.length === 0 && <div className="p-8 text-center text-gray-400">Loading…</div>}
            {!loading && rows.length === 0 && (
                <div className="p-8 text-center text-gray-500 bg-white rounded-lg border border-gray-200">
                    No conflicts in this view. 🎉
                </div>
            )}

            <div className="space-y-4">
                {rows.map((item) => {
                    const key = `${item.question_id}:${item.version_no}`;
                    return (
                        <ConflictCard
                            key={key}
                            item={item}
                            solutionOverride={solutionOverrides[key]}
                            verdict={verdicts[key] || null}
                            setVerdict={(v) => setVerdicts(prev => ({ ...prev, [key]: v }))}
                            submitting={submittingKey === key}
                            onSubmit={(chosen) => submitVerdict(item, chosen)}
                            existingVerdict={existingVerdictFor(item)}
                            onSolutionSaved={onSolutionSaved}
                        />
                    );
                })}
            </div>

            {/* Load more */}
            {rows.length > 0 && (
                <div className="mt-6 flex items-center justify-center">
                    {hasMore ? (
                        <button onClick={() => fetchList(page + 1)} disabled={loading}
                            className="px-5 py-2 rounded-md border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                            {loading ? 'Loading…' : `Load next ${Math.min(LIMIT, total - rows.length)}`}
                        </button>
                    ) : (
                        <span className="text-xs text-gray-400">End of {total} items in this view.</span>
                    )}
                </div>
            )}
        </div>
    );
}

function AnswerBadge({ label, value, tone, warn }) {
    const tones = {
        blue: 'bg-blue-50 border-blue-300 text-blue-800',
        amber: 'bg-amber-50 border-amber-300 text-amber-800',
        purple: 'bg-purple-50 border-purple-300 text-purple-800',
    };
    const warnCls = warn ? 'ring-2 ring-red-400' : '';
    return (
        <div className={`flex-1 rounded-lg border px-4 py-3 ${tones[tone]} ${warnCls}`}>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
            <div className="text-2xl font-bold mt-0.5">{value || '—'}</div>
            {warn && <div className="text-[10px] text-red-700 font-bold mt-0.5">⚠ multi-flag bug</div>}
        </div>
    );
}

function ConflictCard({ item, solutionOverride, verdict, setVerdict, submitting, onSubmit, existingVerdict, onSolutionSaved }) {
    const options = item.options || {};
    const sol = solutionOverride || item.solution_text || null;
    const srcMeta = SOURCE_META[item.pdf_source] || { label: item.pdf_source, color: 'bg-gray-100 text-gray-600 border-gray-300' };
    const stem = item.question_stem?.text || '';

    const displaySections = Array.isArray(sol?.display_sections) ? sol.display_sections : [];
    const coreBasis = sol?.answer_outcome?.core_answer_basis;
    const figureUrl = sol?.answer_outcome?.figure_url;
    const finalAnswerText = sol?.answer_outcome?.final_answer_text;
    const solutionCorrectOption = sol?.answer_outcome?.correct_option;

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
                <AnswerBadge
                    label="Option flag says"
                    value={(item.option_flag_answers || []).join(', ') || '—'}
                    tone="purple"
                    warn={(item.option_flag_answers || []).length > 1} />
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
                        const isOptionFlag = (item.option_flag_answers || []).includes(key);
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
                                    {isOptionFlag && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 whitespace-nowrap">OPTION FLAG</span>}
                                </div>
                            </button>
                        );
                    })}
                    {Object.keys(options).length === 0 && (
                        <div className="text-sm text-gray-400 italic">No options found.</div>
                    )}
                </div>
            </div>

            {/* Worked solution — visible by default, editable */}
            <div className="px-5 pt-4">
                <SolutionPanel
                    item={item}
                    sol={sol}
                    coreBasis={coreBasis}
                    finalAnswerText={finalAnswerText}
                    solutionCorrectOption={solutionCorrectOption}
                    displaySections={displaySections}
                    figureUrl={figureUrl}
                    onSaved={onSolutionSaved}
                />
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

function SolutionPanel({ item, sol, coreBasis, finalAnswerText, solutionCorrectOption, displaySections, figureUrl, onSaved }) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editErr, setEditErr] = useState('');

    // editable drafts
    const [draftBasis, setDraftBasis] = useState('');
    const [draftFinal, setDraftFinal] = useState('');
    const [draftOption, setDraftOption] = useState('');
    const [draftSections, setDraftSections] = useState([]);

    const startEdit = () => {
        setDraftBasis(coreBasis || '');
        setDraftFinal(finalAnswerText || '');
        setDraftOption(solutionCorrectOption || '');
        setDraftSections((displaySections || []).map(s => ({ key: s.key || '', content: s.content || '' })));
        setEditErr('');
        setEditing(true);
    };

    const cancel = () => {
        setEditing(false);
        setEditErr('');
    };

    const saveEdit = async () => {
        setSaving(true);
        setEditErr('');
        try {
            const body = {
                question_id: item.question_id,
                version_no: item.version_no,
                core_answer_basis: draftBasis,
                final_answer_text: draftFinal,
                display_sections: draftSections.map(s => ({ key: s.key, content: s.content })),
            };
            if (draftOption) body.correct_option = draftOption;
            const res = await fetch('/api/answer-conflicts/edit-solution', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
            onSaved(item.question_id, item.version_no, data.solution_json);
            setEditing(false);
        } catch (e) {
            setEditErr(e.message);
        } finally {
            setSaving(false);
        }
    };

    const updateSection = (i, patch) => {
        setDraftSections(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
    };
    const addSection = () => setDraftSections(prev => [...prev, { key: '', content: '' }]);
    const removeSection = (i) => setDraftSections(prev => prev.filter((_, idx) => idx !== i));

    if (!sol && !editing) {
        return (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-md text-sm text-gray-500 italic flex items-center justify-between">
                <span>No solver reasoning available — verify against the answer-key PDF.</span>
                <button onClick={() => { setDraftBasis(''); setDraftFinal(''); setDraftOption(''); setDraftSections([{ key: 'answer_logic', content: '' }]); setEditing(true); }}
                    className="text-xs font-semibold px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700">
                    + Write solution
                </button>
            </div>
        );
    }

    return (
        <div className="bg-slate-50 border border-slate-200 rounded-md">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
                <div className="text-sm font-semibold text-gray-700">
                    Worked solution
                    <span className="ml-2 text-xs font-normal text-gray-400">({item.solution_status || 'no status'})</span>
                </div>
                {editing ? (
                    <div className="flex gap-2">
                        <button onClick={cancel} disabled={saving}
                            className="text-xs px-2.5 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 text-gray-700">Cancel</button>
                        <button onClick={saveEdit} disabled={saving}
                            className="text-xs px-2.5 py-1 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">
                            {saving ? 'Saving…' : 'Save solution'}
                        </button>
                    </div>
                ) : (
                    <button onClick={startEdit}
                        className="text-xs font-semibold px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700">
                        Edit solution
                    </button>
                )}
            </div>

            {editErr && (
                <div className="mx-4 mt-3 p-2 bg-red-50 text-red-700 border border-red-200 rounded text-xs">{editErr}</div>
            )}

            <div className="p-4 text-sm text-gray-700 space-y-3">
                {editing ? (
                    <>
                        <FieldEdit label="Correct option" hint="A / B / C / D — sync with the answer key">
                            <div className="flex gap-1">
                                {['A', 'B', 'C', 'D'].map(k => (
                                    <button key={k} onClick={() => setDraftOption(k)}
                                        className={`w-9 h-9 rounded border font-bold text-sm
                                            ${draftOption === k ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>
                                        {k}
                                    </button>
                                ))}
                                {draftOption && (
                                    <button onClick={() => setDraftOption('')}
                                        className="text-xs text-gray-500 underline ml-2">clear</button>
                                )}
                            </div>
                        </FieldEdit>
                        <FieldEdit label="Final answer text" hint="The text of the correct option">
                            <input type="text" value={draftFinal} onChange={e => setDraftFinal(e.target.value)}
                                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white" />
                        </FieldEdit>
                        <FieldEdit label="Core basis" hint="One/two sentences on why the new answer is correct">
                            <textarea value={draftBasis} onChange={e => setDraftBasis(e.target.value)} rows={3}
                                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white font-mono" />
                        </FieldEdit>

                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">Display sections</div>
                                <button onClick={addSection} className="text-xs text-blue-600 hover:underline">+ Add section</button>
                            </div>
                            <div className="space-y-2">
                                {draftSections.map((sec, i) => (
                                    <div key={i} className="border border-gray-200 rounded p-2 bg-white">
                                        <div className="flex items-center gap-2 mb-1">
                                            <input type="text" value={sec.key}
                                                onChange={e => updateSection(i, { key: e.target.value })}
                                                placeholder="key (e.g. answer_logic)"
                                                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 font-mono" />
                                            <button onClick={() => removeSection(i)}
                                                className="text-xs text-red-600 hover:underline">Remove</button>
                                        </div>
                                        <textarea value={sec.content}
                                            onChange={e => updateSection(i, { content: e.target.value })}
                                            rows={4}
                                            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 font-mono" />
                                    </div>
                                ))}
                                {draftSections.length === 0 && (
                                    <div className="text-xs text-gray-400 italic">No sections — click "+ Add section" to add one.</div>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        {solutionCorrectOption && (
                            <div className="text-xs text-gray-500">
                                Solver's correct option: <span className="font-bold text-gray-800">{solutionCorrectOption}</span>
                                {finalAnswerText && <span className="ml-1">— "<span className="italic">{finalAnswerText}</span>"</span>}
                            </div>
                        )}
                        {coreBasis && (
                            <div>
                                <div className="text-xs font-bold text-gray-500 uppercase mb-0.5">Core basis</div>
                                <Latex>{coreBasis}</Latex>
                            </div>
                        )}
                        {displaySections.map((sec, i) => (
                            <div key={i}>
                                <div className="text-xs font-bold text-gray-500 uppercase mb-0.5">{(sec.key || '').replace(/_/g, ' ')}</div>
                                <Latex>{sec.content || ''}</Latex>
                            </div>
                        ))}
                        {figureUrl && (
                            <div>
                                <div className="text-xs font-bold text-gray-500 uppercase mb-1">Figure</div>
                                <img src={figureUrl} alt="Solution figure" className="max-h-64 rounded border border-gray-300 object-contain" />
                            </div>
                        )}
                        {!coreBasis && displaySections.length === 0 && !figureUrl && (
                            <div className="text-gray-400 italic">No worked solution content yet. Click "Edit solution" to add one.</div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function FieldEdit({ label, hint, children }) {
    return (
        <div>
            <div className="flex items-baseline justify-between mb-1">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">{label}</div>
                {hint && <div className="text-[11px] text-gray-400 italic">{hint}</div>}
            </div>
            {children}
        </div>
    );
}
