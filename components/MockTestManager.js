'use client';

import { useState, useEffect } from 'react';
import Latex from '@/components/Latex';

const DIFF_LABELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const DIFF_COLORS = { 1: 'bg-green-100 text-green-700', 2: 'bg-yellow-100 text-yellow-700', 3: 'bg-red-100 text-red-700' };

// =========================================================
// Tab: Existing Mocks List
// =========================================================
function MocksList({ examId, onOpenMock }) {
    const [mocks, setMocks] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!examId) return;
        setLoading(true);
        fetch(`/api/mock-test/list?exam_id=${examId}`)
            .then(r => r.json())
            .then(d => setMocks(d.mocks || []))
            .catch(() => setMocks([]))
            .finally(() => setLoading(false));
    }, [examId]);

    if (loading) return <div className="text-sm text-gray-400 py-8 text-center">Loading mocks...</div>;
    if (mocks.length === 0) return <div className="text-sm text-gray-400 py-8 text-center">No mock tests yet for this exam.</div>;

    const statusColors = {
        DRAFT: 'bg-gray-100 text-gray-600',
        IN_REVIEW: 'bg-blue-100 text-blue-700',
        APPROVED: 'bg-green-100 text-green-700',
        PUBLISHED: 'bg-purple-100 text-purple-700',
        ARCHIVED: 'bg-red-100 text-red-700',
    };

    return (
        <div className="space-y-3">
            {mocks.map(m => (
                <div key={m.mock_test_id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-semibold text-gray-900">{m.name}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                                {m.blueprint_name && <span className="mr-3">Blueprint: {m.blueprint_name}</span>}
                                Created: {new Date(m.created_at).toLocaleDateString('en-IN')}
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColors[m.status] || 'bg-gray-100'}`}>
                                {m.status}
                            </span>
                            <div className="text-xs text-gray-500">
                                <span className="text-green-600 font-bold">{m.approved_count || 0}</span>
                                <span className="mx-0.5">/</span>
                                <span className="text-red-600 font-bold">{m.rejected_count || 0}</span>
                                <span className="mx-0.5">/</span>
                                <span className="text-gray-400">{m.pending_count || 0}</span>
                                <span className="ml-1 text-gray-400">({m.total_questions} total)</span>
                            </div>
                            <button onClick={() => onOpenMock(m.mock_test_id)}
                                className="px-3 py-1 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700">
                                Review
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

// =========================================================
// Tab: Blueprint + Generate
// =========================================================
function BlueprintPanel({ examId }) {
    const [blueprints, setBlueprints] = useState([]);
    const [analysis, setAnalysis] = useState(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [savingBp, setSavingBp] = useState(false);
    const [bpName, setBpName] = useState('');
    const [mockName, setMockName] = useState('');
    const [selectedBp, setSelectedBp] = useState(null);
    const [generateResult, setGenerateResult] = useState(null);
    const [feedback, setFeedback] = useState(null);

    // Load existing blueprints
    useEffect(() => {
        if (!examId) return;
        fetch(`/api/mock-test/blueprint/list?exam_id=${examId}`)
            .then(r => r.json())
            .then(d => setBlueprints(d.blueprints || []))
            .catch(() => {});
    }, [examId]);

    const handleAnalyze = async () => {
        setAnalyzing(true);
        setFeedback(null);
        try {
            const res = await fetch('/api/mock-test/blueprint/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exam_id: examId }),
            });
            const data = await res.json();
            if (res.ok) {
                setAnalysis(data);
                setBpName(`${data.exam?.name || 'Exam'} — Auto Blueprint`);
            } else {
                setFeedback({ type: 'error', msg: data.error });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setAnalyzing(false);
        }
    };

    const handleSaveBlueprint = async () => {
        if (!analysis || !bpName) return;
        setSavingBp(true);
        try {
            const res = await fetch('/api/mock-test/blueprint/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exam_id: examId, name: bpName, config_json: analysis.suggested_config }),
            });
            const data = await res.json();
            if (res.ok) {
                setFeedback({ type: 'success', msg: 'Blueprint saved!' });
                setBlueprints(prev => [{ blueprint_id: data.blueprint_id, name: bpName, config_json: analysis.suggested_config }, ...prev]);
                setSelectedBp(data.blueprint_id);
            } else {
                setFeedback({ type: 'error', msg: data.error });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setSavingBp(false);
        }
    };

    const handleGenerate = async () => {
        const bpId = selectedBp || blueprints[0]?.blueprint_id;
        if (!bpId) return setFeedback({ type: 'error', msg: 'Select or create a blueprint first' });
        setGenerating(true);
        setGenerateResult(null);
        setFeedback(null);
        try {
            const res = await fetch('/api/mock-test/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ blueprint_id: bpId, name: mockName || undefined }),
            });
            const data = await res.json();
            if (res.ok) {
                setGenerateResult(data);
                setFeedback({ type: 'success', msg: `Mock generated: ${data.total_selected}/${data.total_target} questions selected` });
            } else {
                setFeedback({ type: 'error', msg: data.error });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="space-y-6">
            {feedback && (
                <div className={`text-sm px-4 py-2 rounded ${feedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {feedback.msg}
                </div>
            )}

            {/* Existing blueprints */}
            {blueprints.length > 0 && (
                <div>
                    <h3 className="text-sm font-bold text-gray-700 mb-2">Saved Blueprints</h3>
                    <div className="space-y-2">
                        {blueprints.map(bp => (
                            <label key={bp.blueprint_id} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${selectedBp === bp.blueprint_id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                                <input type="radio" name="blueprint" checked={selectedBp === bp.blueprint_id}
                                    onChange={() => setSelectedBp(bp.blueprint_id)} className="accent-blue-600" />
                                <div>
                                    <div className="text-sm font-semibold text-gray-800">{bp.name}</div>
                                    <div className="text-xs text-gray-500">
                                        {(bp.config_json?.sections || []).map(s => `${s.code}: ${s.total}`).join(' · ')}
                                    </div>
                                </div>
                            </label>
                        ))}
                    </div>
                </div>
            )}

            {/* Analyze button */}
            <div className="flex items-center gap-3">
                <button onClick={handleAnalyze} disabled={analyzing}
                    className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    {analyzing ? 'Analyzing...' : 'Analyze Past Papers'}
                </button>
                <span className="text-xs text-gray-400">Scans solved questions to suggest topic/difficulty distribution</span>
            </div>

            {/* Analysis result */}
            {analysis && (
                <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-indigo-800">
                            Analysis: {analysis.exam?.name} ({analysis.total_papers} papers)
                        </h3>
                        <div className="flex items-center gap-2">
                            <input value={bpName} onChange={e => setBpName(e.target.value)}
                                className="border rounded px-2 py-1 text-sm w-64" placeholder="Blueprint name..." />
                            <button onClick={handleSaveBlueprint} disabled={savingBp || !bpName}
                                className="px-3 py-1 text-xs font-semibold bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
                                {savingBp ? 'Saving...' : 'Save Blueprint'}
                            </button>
                        </div>
                    </div>
                    {analysis.suggested_config?.sections?.map(sec => (
                        <div key={sec.code} className="mb-4">
                            <div className="text-xs font-bold text-gray-700 mb-1">
                                {sec.name} ({sec.code}) — {sec.total} questions
                                <span className="ml-2 font-normal text-gray-500">
                                    E:{sec.stats?.easy_pct}% M:{sec.stats?.medium_pct}% H:{sec.stats?.hard_pct}%
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {sec.topic_slots?.map(slot => (
                                    <span key={slot.subtype} className="text-xs bg-white border border-gray-200 px-2 py-0.5 rounded">
                                        {slot.subtype}: <strong>{slot.count}</strong>
                                        <span className="text-gray-400 ml-1">(pool: {slot.total_in_pool})</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Generate */}
            <div className="border-t border-gray-200 pt-4">
                <h3 className="text-sm font-bold text-gray-700 mb-2">Generate Mock Test</h3>
                <div className="flex items-center gap-3">
                    <input value={mockName} onChange={e => setMockName(e.target.value)}
                        className="border rounded px-3 py-2 text-sm w-72" placeholder="Mock test name (optional)..." />
                    <button onClick={handleGenerate} disabled={generating}
                        className="px-4 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                        {generating ? 'Generating...' : 'Generate Draft Mock'}
                    </button>
                </div>
            </div>

            {/* Generation result */}
            {generateResult && (
                <div className="border border-green-200 rounded-lg p-4 bg-green-50">
                    <div className="text-sm font-bold text-green-800 mb-2">
                        Mock Generated: {generateResult.total_selected}/{generateResult.total_target} questions
                    </div>
                    {generateResult.sections?.map(sec => (
                        <div key={sec.code} className="text-xs text-gray-700 mb-1">
                            <strong>{sec.code}</strong>: {sec.selected}/{sec.target} selected (pool: {sec.pool_size})
                            {sec.difficulty && !sec.difficulty.ok && (
                                <span className="ml-2 text-amber-600">Difficulty issues: {sec.difficulty.issues?.join(', ')}</span>
                            )}
                            {sec.answer_balance && !sec.answer_balance.ok && (
                                <span className="ml-2 text-amber-600">Balance: {sec.answer_balance.issues?.join(', ')}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// =========================================================
// Tab: Mock Review (the main review UI)
// =========================================================
function MockReview({ mockTestId, onBack }) {
    const [mockData, setMockData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [suggestions, setSuggestions] = useState(null);
    const [suggestingFor, setSuggestingFor] = useState(null);
    const [actionLoading, setActionLoading] = useState(null);
    const [feedback, setFeedback] = useState(null);

    const loadMock = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}`);
            const data = await res.json();
            if (res.ok) setMockData(data);
            else setFeedback({ type: 'error', msg: data.error });
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadMock(); }, [mockTestId]);

    const handleReview = async (questionId, action, note) => {
        setActionLoading(questionId);
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reviews: [{ question_id: questionId, action, rejection_note: note }] }),
            });
            const data = await res.json();
            if (res.ok) {
                setFeedback({ type: 'success', msg: `${action === 'approve' ? 'Approved' : 'Rejected'}` });
                await loadMock();
            } else {
                setFeedback({ type: 'error', msg: data.error });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setActionLoading(null);
            setTimeout(() => setFeedback(null), 2000);
        }
    };

    const handleApproveAll = async () => {
        if (!mockData) return;
        const pendingQs = [];
        for (const sec of mockData.sections) {
            for (const q of sec.questions) {
                if (q.review_status === 'PENDING') pendingQs.push(q.question_id);
            }
        }
        if (pendingQs.length === 0) return;
        if (!confirm(`Approve all ${pendingQs.length} pending questions?`)) return;
        setActionLoading('bulk');
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reviews: pendingQs.map(qid => ({ question_id: qid, action: 'approve' })) }),
            });
            if (res.ok) await loadMock();
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setActionLoading(null);
        }
    };

    const handleSuggest = async (questionId) => {
        setSuggestingFor(questionId);
        setSuggestions(null);
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/suggest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id: questionId }),
            });
            const data = await res.json();
            if (res.ok) setSuggestions(data);
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        }
    };

    const handleSwap = async (oldId, newId) => {
        setActionLoading(newId);
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/swap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_question_id: oldId, new_question_id: newId }),
            });
            if (res.ok) {
                setSuggestions(null);
                setSuggestingFor(null);
                await loadMock();
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setActionLoading(null);
        }
    };

    const handlePublish = async () => {
        if (!confirm('Publish this mock test? This will lock all questions and record them as used.')) return;
        setActionLoading('publish');
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const data = await res.json();
            if (res.ok) {
                setFeedback({ type: 'success', msg: 'Published!' });
                await loadMock();
            } else {
                setFeedback({ type: 'error', msg: data.error });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) return <div className="text-center py-16 text-gray-400">Loading mock test...</div>;
    if (!mockData) return <div className="text-center py-16 text-red-500">Failed to load.</div>;

    const { mock, sections, review_summary } = mockData;
    const canPublish = mock.status === 'APPROVED';

    return (
        <div>
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm px-4 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onBack} className="text-sm text-blue-600 hover:text-blue-800 font-medium">&larr; Back</button>
                        <div>
                            <h2 className="text-base font-bold text-gray-900">{mock.name}</h2>
                            <div className="text-xs text-gray-500">
                                {mock.exam_name} &middot; Status: <strong>{mock.status}</strong> &middot;
                                <span className="text-green-600 ml-1">{review_summary.approved} approved</span> /
                                <span className="text-red-600 ml-1">{review_summary.rejected} rejected</span> /
                                <span className="text-gray-400 ml-1">{review_summary.pending} pending</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {feedback && (
                            <span className={`text-xs font-semibold px-2 py-1 rounded ${feedback.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {feedback.msg}
                            </span>
                        )}
                        {review_summary.pending > 0 && (
                            <button onClick={handleApproveAll} disabled={actionLoading === 'bulk'}
                                className="px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
                                {actionLoading === 'bulk' ? '...' : `Approve All (${review_summary.pending})`}
                            </button>
                        )}
                        {canPublish && (
                            <button onClick={handlePublish} disabled={actionLoading === 'publish'}
                                className="px-3 py-1.5 text-xs font-semibold bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">
                                {actionLoading === 'publish' ? 'Publishing...' : 'Publish'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Sections + Questions */}
            <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
                {sections.map(sec => (
                    <div key={sec.exam_section_id}>
                        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-3 border-b pb-2">
                            {sec.name} ({sec.code}) — {sec.questions.length} questions
                        </h3>
                        <div className="space-y-4">
                            {sec.questions.map(q => (
                                <ReviewQuestionCard
                                    key={q.question_id}
                                    q={q}
                                    onApprove={() => handleReview(q.question_id, 'approve')}
                                    onReject={(note) => handleReview(q.question_id, 'reject', note)}
                                    onSuggest={() => handleSuggest(q.question_id)}
                                    suggestions={suggestingFor === q.question_id ? suggestions : null}
                                    onSwap={(newId) => handleSwap(q.question_id, newId)}
                                    actionLoading={actionLoading}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ReviewQuestionCard({ q, onApprove, onReject, onSuggest, suggestions, onSwap, actionLoading }) {
    const [rejectNote, setRejectNote] = useState('');
    const [showRejectInput, setShowRejectInput] = useState(false);

    const statusBg = {
        PENDING: 'border-gray-200',
        APPROVED: 'border-green-300 bg-green-50/30',
        REJECTED: 'border-red-300 bg-red-50/30',
    };

    return (
        <div className={`border rounded-lg overflow-hidden ${statusBg[q.review_status] || 'border-gray-200'}`}>
            {/* Header */}
            <div className="px-4 py-2 bg-gray-50 border-b flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-gray-700">#{q.position}</span>
                    <span className="text-xs font-mono text-gray-400">{(q.question_id || '').slice(0, 8)}</span>
                    {q.subtype && <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{q.subtype}</span>}
                    {q.difficulty && <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${DIFF_COLORS[q.difficulty] || ''}`}>{DIFF_LABELS[q.difficulty]}</span>}
                    {q.correct_option_label && <span className="text-xs font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded">Ans: {q.correct_option_label}</span>}
                    <span className="text-xs text-gray-400">|</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${q.source_type === 'pyq' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
                        {q.source_label}
                    </span>
                    {q.slot_subtype && q.slot_subtype !== q.subtype && (
                        <span className="text-xs text-gray-400">(slot: {q.slot_subtype})</span>
                    )}
                </div>
                <div className="flex items-center gap-1.5">
                    {q.review_status === 'PENDING' && (
                        <>
                            <button onClick={onApprove} disabled={actionLoading === q.question_id}
                                className="px-2.5 py-1 text-xs font-semibold bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
                                Approve
                            </button>
                            <button onClick={() => setShowRejectInput(!showRejectInput)}
                                className="px-2.5 py-1 text-xs font-semibold bg-red-500 text-white rounded hover:bg-red-600">
                                Reject
                            </button>
                        </>
                    )}
                    {q.review_status === 'APPROVED' && (
                        <span className="text-xs font-bold text-green-700">APPROVED</span>
                    )}
                    {q.review_status === 'REJECTED' && (
                        <>
                            <span className="text-xs font-bold text-red-700">REJECTED</span>
                            <button onClick={onSuggest} className="px-2.5 py-1 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700">
                                Suggest Replacement
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Reject note input */}
            {showRejectInput && (
                <div className="px-4 py-2 bg-red-50 border-b flex items-center gap-2">
                    <input value={rejectNote} onChange={e => setRejectNote(e.target.value)}
                        className="flex-1 border rounded px-2 py-1 text-xs" placeholder="Reason (optional)..." />
                    <button onClick={() => { onReject(rejectNote); setShowRejectInput(false); setRejectNote(''); }}
                        className="px-2.5 py-1 text-xs font-semibold bg-red-600 text-white rounded hover:bg-red-700">
                        Confirm Reject
                    </button>
                </div>
            )}

            {/* Question text */}
            <div className="px-4 py-3">
                <div className="text-sm text-gray-800 mb-2"><Latex>{q.question_text || '(No text)'}</Latex></div>
                <div className="grid grid-cols-2 gap-2">
                    {(q.options || []).map(opt => (
                        <div key={opt.opt_label}
                            className={`text-xs p-2 rounded border ${opt.opt_label === q.correct_option_label ? 'bg-green-50 border-green-300 font-semibold' : 'bg-white border-gray-200'}`}>
                            <span className="font-bold mr-1">{opt.opt_label})</span>
                            <Latex>{opt.opt_text || ''}</Latex>
                        </div>
                    ))}
                </div>
            </div>

            {/* Rejection note */}
            {q.rejection_note && (
                <div className="px-4 py-2 bg-red-50 border-t text-xs text-red-700">
                    Rejection: {q.rejection_note}
                </div>
            )}

            {/* Suggestions */}
            {suggestions && (
                <div className="px-4 py-3 bg-blue-50 border-t">
                    <div className="text-xs font-bold text-blue-800 mb-2">
                        Replacement Suggestions (slot: {suggestions.slot?.subtype}, {suggestions.slot?.difficulty})
                    </div>
                    {suggestions.suggestions?.length === 0 ? (
                        <div className="text-xs text-gray-500">No alternatives found for this slot.</div>
                    ) : (
                        <div className="space-y-3">
                            {suggestions.suggestions.map(s => (
                                <div key={s.question_id} className="border border-blue-200 rounded p-3 bg-white">
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono text-gray-400">{s.question_id.slice(0, 8)}</span>
                                            <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{s.subtype}</span>
                                            <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${DIFF_COLORS[s.difficulty] || ''}`}>{DIFF_LABELS[s.difficulty]}</span>
                                            <span className={`text-xs px-1.5 py-0.5 rounded ${s.source_type === 'pyq' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
                                                {s.source_label}
                                            </span>
                                        </div>
                                        <button onClick={() => onSwap(s.question_id)} disabled={actionLoading === s.question_id}
                                            className="px-2.5 py-1 text-xs font-semibold bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
                                            {actionLoading === s.question_id ? '...' : 'Use This'}
                                        </button>
                                    </div>
                                    <div className="text-xs text-gray-700"><Latex>{s.question_text || ''}</Latex></div>
                                    <div className="flex gap-2 mt-1">
                                        {(s.options || []).map(o => (
                                            <span key={o.opt_label} className={`text-xs px-1.5 py-0.5 rounded border ${o.opt_label === s.correct_option_label ? 'bg-green-50 border-green-300' : 'border-gray-200'}`}>
                                                {o.opt_label}) <Latex>{o.opt_text || ''}</Latex>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// =========================================================
// Main Manager Component
// =========================================================
export default function MockTestManager({ exams }) {
    const [selectedExamId, setSelectedExamId] = useState('');
    const [activeTab, setActiveTab] = useState('mocks'); // 'mocks' | 'create'
    const [reviewingMockId, setReviewingMockId] = useState(null);

    if (reviewingMockId) {
        return <MockReview mockTestId={reviewingMockId} onBack={() => setReviewingMockId(null)} />;
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Top bar */}
            <div className="bg-white border-b border-gray-200 shadow-sm px-6 py-4">
                <div className="max-w-5xl mx-auto flex items-center gap-4 flex-wrap">
                    <h1 className="text-lg font-bold text-gray-900">Mock Tests</h1>
                    <select value={selectedExamId} onChange={e => setSelectedExamId(e.target.value)}
                        className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-w-[250px] focus:ring-2 focus:ring-blue-500">
                        <option value="">Select Exam...</option>
                        {exams.map(e => (
                            <option key={e.exam_id} value={e.exam_id}>{e.name}</option>
                        ))}
                    </select>
                    {selectedExamId && (
                        <div className="flex gap-1">
                            {['mocks', 'create'].map(tab => (
                                <button key={tab} onClick={() => setActiveTab(tab)}
                                    className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                    {tab === 'mocks' ? 'Existing Mocks' : 'Create New'}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="max-w-5xl mx-auto px-6 py-6">
                {!selectedExamId ? (
                    <div className="text-center py-24 text-gray-400">Select an exam to manage mock tests.</div>
                ) : activeTab === 'mocks' ? (
                    <MocksList examId={selectedExamId} onOpenMock={setReviewingMockId} />
                ) : (
                    <BlueprintPanel examId={selectedExamId} />
                )}
            </div>
        </div>
    );
}
