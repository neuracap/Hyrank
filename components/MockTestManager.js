'use client';

import { useState, useEffect } from 'react';
import Latex from '@/components/Latex';

const DIFF_LABELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const DIFF_COLORS = { 1: 'bg-green-100 text-green-700', 2: 'bg-yellow-100 text-yellow-700', 3: 'bg-red-100 text-red-700' };

const LEVEL_LETTERS = { 1: 'A', 2: 'B', 3: 'C' };
const LEVEL_LABELS  = { 1: 'Easy (A)', 2: 'Medium (B)', 3: 'Hard (C)' };
const LEVEL_MIX_LABEL = { 1: '40 / 50 / 10', 2: '10 / 60 / 30', 3: '0 / 30 / 70' };

// =========================================================
// Tab: Existing Mocks List
// =========================================================
function MocksList({ examId, onOpenMock }) {
    const [mocks, setMocks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [saving, setSaving] = useState(false);
    const [renameError, setRenameError] = useState(null);
    const [typeFilter, setTypeFilter] = useState('ALL'); // ALL | FULL_MOCK | SECTION | TOPIC
    const [statusFilter, setStatusFilter] = useState('ALL'); // ALL | DRAFT | IN_REVIEW | APPROVED | PUBLISHED | ARCHIVED

    const reload = () => {
        if (!examId) return;
        setLoading(true);
        fetch(`/api/mock-test/list?exam_id=${examId}`)
            .then(r => r.json())
            .then(d => setMocks(d.mocks || []))
            .catch(() => setMocks([]))
            .finally(() => setLoading(false));
    };

    useEffect(() => { reload(); /* eslint-disable-next-line */ }, [examId]);

    const startEdit = (m) => {
        setEditingId(m.mock_test_id);
        setEditName(m.name);
        setRenameError(null);
    };
    const cancelEdit = () => {
        setEditingId(null);
        setEditName('');
        setRenameError(null);
    };
    const saveEdit = async (m) => {
        const name = editName.trim();
        if (!name || name === m.name) { cancelEdit(); return; }
        setSaving(true);
        setRenameError(null);
        try {
            const res = await fetch(`/api/mock-test/${m.mock_test_id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (!res.ok) {
                setRenameError(data.error || 'Rename failed');
                setSaving(false);
                return;
            }
            setMocks(prev => prev.map(x =>
                x.mock_test_id === m.mock_test_id ? { ...x, name: data.name } : x
            ));
            cancelEdit();
        } catch (e) {
            setRenameError(e.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="text-sm text-gray-400 py-8 text-center">Loading mocks...</div>;
    if (mocks.length === 0) return <div className="text-sm text-gray-400 py-8 text-center">No mock tests yet for this exam.</div>;

    const statusColors = {
        DRAFT: 'bg-gray-100 text-gray-600',
        IN_REVIEW: 'bg-blue-100 text-blue-700',
        APPROVED: 'bg-green-100 text-green-700',
        PUBLISHED: 'bg-purple-100 text-purple-700',
        ARCHIVED: 'bg-red-100 text-red-700',
    };

    const TYPE_OPTIONS = [
        { key: 'ALL',       label: 'All' },
        { key: 'FULL_MOCK', label: 'Full Mock' },
        { key: 'SECTION',   label: 'Section' },
        { key: 'TOPIC',     label: 'Topic' },
    ];
    const STATUS_OPTIONS = [
        { key: 'ALL',       label: 'All' },
        { key: 'DRAFT',     label: 'Draft' },
        { key: 'IN_REVIEW', label: 'In Review' },
        { key: 'APPROVED',  label: 'Approved' },
        { key: 'PUBLISHED', label: 'Published' },
        { key: 'ARCHIVED',  label: 'Archived' },
    ];

    // Apply type filter first, then derive status counts from that pool
    const afterType = typeFilter === 'ALL'
        ? mocks
        : mocks.filter(m => (m.test_type || 'FULL_MOCK') === typeFilter);

    const typeCounts = mocks.reduce((acc, m) => {
        const t = m.test_type || 'FULL_MOCK';
        acc[t] = (acc[t] || 0) + 1;
        return acc;
    }, {});
    const statusCounts = afterType.reduce((acc, m) => {
        const s = m.status || 'DRAFT';
        acc[s] = (acc[s] || 0) + 1;
        return acc;
    }, {});

    const visibleMocks = statusFilter === 'ALL'
        ? afterType
        : afterType.filter(m => (m.status || 'DRAFT') === statusFilter);

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500 mr-1 w-12">Type:</span>
                {TYPE_OPTIONS.map(opt => {
                    const count = opt.key === 'ALL' ? mocks.length : (typeCounts[opt.key] || 0);
                    const active = typeFilter === opt.key;
                    return (
                        <button
                            key={opt.key}
                            onClick={() => setTypeFilter(opt.key)}
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
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500 mr-1 w-12">Status:</span>
                {STATUS_OPTIONS.map(opt => {
                    const count = opt.key === 'ALL' ? afterType.length : (statusCounts[opt.key] || 0);
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
            {visibleMocks.length === 0 && (
                <div className="text-sm text-gray-400 py-6 text-center">No mocks match this filter.</div>
            )}
            {visibleMocks.map(m => (
                <div key={m.mock_test_id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                    <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                            {editingId === m.mock_test_id ? (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <input
                                        type="text"
                                        value={editName}
                                        autoFocus
                                        onChange={e => setEditName(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') saveEdit(m);
                                            if (e.key === 'Escape') cancelEdit();
                                        }}
                                        disabled={saving}
                                        className="text-sm font-semibold border border-blue-400 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500"
                                    />
                                    <button onClick={() => saveEdit(m)} disabled={saving}
                                        className="text-xs font-semibold bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50">
                                        {saving ? 'Saving…' : 'Save'}
                                    </button>
                                    <button onClick={cancelEdit} disabled={saving}
                                        className="text-xs font-semibold bg-gray-100 text-gray-700 px-3 py-1 rounded hover:bg-gray-200">
                                        Cancel
                                    </button>
                                    {renameError && <span className="text-xs text-red-600">{renameError}</span>}
                                </div>
                            ) : (
                                <div className="font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                                    {m.name}
                                    <button onClick={() => startEdit(m)}
                                        title="Rename"
                                        className="text-gray-400 hover:text-blue-600 text-xs">
                                        ✎
                                    </button>
                                    {m.test_type && m.test_type !== 'FULL_MOCK' && (
                                        <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                            {m.test_type}
                                        </span>
                                    )}
                                    {m.difficulty_level && (
                                        <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                                            Level {LEVEL_LETTERS[m.difficulty_level] || '?'}
                                        </span>
                                    )}
                                    {m.exam_name && m.test_type !== 'FULL_MOCK' && (
                                        <span className="text-[10px] font-normal text-gray-400">
                                            origin: {m.exam_name}
                                        </span>
                                    )}
                                </div>
                            )}
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

    const handleEditQuestion = async (questionId, patch) => {
        setActionLoading(`edit-${questionId}`);
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/edit-question`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id: questionId, ...patch }),
            });
            const data = await res.json();
            if (!res.ok) {
                setFeedback({ type: 'error', msg: data.error || 'Edit failed' });
                throw new Error(data.error || 'Edit failed');
            }
            setFeedback({ type: 'success', msg: 'Saved' });
            await loadMock();
        } finally {
            setActionLoading(null);
            setTimeout(() => setFeedback(null), 2000);
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
                {sections.map(sec => {
                    let prevGroupId = null;
                    return (
                        <div key={sec.exam_section_id}>
                            <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-3 border-b pb-2">
                                {sec.name} ({sec.code}) — {sec.questions.length} questions
                            </h3>
                            <div className="space-y-4">
                                {sec.questions.map(q => {
                                    const showPassage =
                                        q.group_id &&
                                        q.group_id !== prevGroupId &&
                                        q.stimulus?.passage_body?.text;
                                    prevGroupId = q.group_id || null;
                                    return (
                                        <div key={q.question_id}>
                                            {showPassage && (
                                                <div className="border border-purple-200 bg-purple-50/40 rounded-lg p-4 mb-3">
                                                    <div className="text-[10px] font-bold text-purple-700 uppercase mb-2">
                                                        {q.stimulus.group_type || 'GROUP'} — Passage / Stimulus
                                                    </div>
                                                    <div className="text-sm text-gray-800 whitespace-pre-wrap">
                                                        <Latex>{q.stimulus.passage_body.text}</Latex>
                                                    </div>
                                                </div>
                                            )}
                                            <ReviewQuestionCard
                                                q={q}
                                                onApprove={() => handleReview(q.question_id, 'approve')}
                                                onReject={(note) => handleReview(q.question_id, 'reject', note)}
                                                onSuggest={() => handleSuggest(q.question_id)}
                                                suggestions={suggestingFor === q.question_id ? suggestions : null}
                                                onSwap={(newId) => handleSwap(q.question_id, newId)}
                                                onEdit={(patch) => handleEditQuestion(q.question_id, patch)}
                                                actionLoading={actionLoading}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ReviewQuestionCard({ q, onApprove, onReject, onSuggest, suggestions, onSwap, onEdit, actionLoading }) {
    const [rejectNote, setRejectNote] = useState('');
    const [showRejectInput, setShowRejectInput] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draftStem, setDraftStem] = useState('');
    const [draftOpts, setDraftOpts] = useState({ A: '', B: '', C: '', D: '' });
    const [draftCorrect, setDraftCorrect] = useState(null);
    const [draftDifficulty, setDraftDifficulty] = useState(null);
    const [editErr, setEditErr] = useState(null);

    const statusBg = {
        PENDING: 'border-gray-200',
        APPROVED: 'border-green-300 bg-green-50/30',
        REJECTED: 'border-red-300 bg-red-50/30',
    };

    const startEdit = () => {
        setDraftStem(q.question_text || '');
        const opts = { A: '', B: '', C: '', D: '' };
        for (const o of (q.options || [])) opts[o.opt_label] = o.opt_text || '';
        setDraftOpts(opts);
        setDraftCorrect(q.correct_option_label || null);
        setDraftDifficulty(q.difficulty ?? null);
        setEditErr(null);
        setEditing(true);
    };

    const cancelEdit = () => {
        setEditing(false);
        setEditErr(null);
    };

    const saveEdit = async () => {
        const optsByLabel = Object.fromEntries((q.options || []).map(o => [o.opt_label, o.opt_text || '']));
        const patch = {};
        if (draftStem !== (q.question_text || '')) patch.stem = draftStem;
        const optsPatch = {};
        for (const k of ['A', 'B', 'C', 'D']) {
            if (draftOpts[k] !== (optsByLabel[k] ?? '')) optsPatch[k] = draftOpts[k];
        }
        if (Object.keys(optsPatch).length > 0) patch.options = optsPatch;
        if (draftCorrect && draftCorrect !== q.correct_option_label) patch.correct_option_label = draftCorrect;
        if (draftDifficulty != null && draftDifficulty !== q.difficulty) patch.difficulty = Number(draftDifficulty);
        if (Object.keys(patch).length === 0) { cancelEdit(); return; }
        try {
            await onEdit(patch);
            setEditing(false);
        } catch (e) {
            setEditErr(e.message);
        }
    };

    const editBusy = actionLoading === `edit-${q.question_id}`;

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
                    {!editing && (
                        <button onClick={startEdit}
                            className="px-2.5 py-1 text-xs font-semibold border border-blue-300 text-blue-700 bg-white rounded hover:bg-blue-50">
                            Edit
                        </button>
                    )}
                    {q.review_status === 'PENDING' && !editing && (
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
                    {q.review_status === 'APPROVED' && !editing && (
                        <span className="text-xs font-bold text-green-700">APPROVED</span>
                    )}
                    {q.review_status === 'REJECTED' && !editing && (
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
            {showRejectInput && !editing && (
                <div className="px-4 py-2 bg-red-50 border-b flex items-center gap-2">
                    <input value={rejectNote} onChange={e => setRejectNote(e.target.value)}
                        className="flex-1 border rounded px-2 py-1 text-xs" placeholder="Reason (optional)..." />
                    <button onClick={() => { onReject(rejectNote); setShowRejectInput(false); setRejectNote(''); }}
                        className="px-2.5 py-1 text-xs font-semibold bg-red-600 text-white rounded hover:bg-red-700">
                        Confirm Reject
                    </button>
                </div>
            )}

            {/* Question text — read or edit */}
            <div className="px-4 py-3">
                {!editing ? (
                    <>
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
                    </>
                ) : (
                    <div className="space-y-3">
                        <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Stem</label>
                            <textarea
                                value={draftStem}
                                onChange={e => setDraftStem(e.target.value)}
                                rows={Math.max(2, Math.min(10, Math.ceil((draftStem.length || 0) / 80)))}
                                className="w-full text-sm border border-blue-300 rounded px-2 py-1.5 font-mono focus:ring-2 focus:ring-blue-400"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {['A', 'B', 'C', 'D'].map(k => (
                                <label key={k} className="block">
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">Option {k}</span>
                                    <input
                                        type="text"
                                        value={draftOpts[k]}
                                        onChange={e => setDraftOpts(o => ({ ...o, [k]: e.target.value }))}
                                        className="w-full text-xs border border-gray-300 rounded px-2 py-1 mt-0.5 font-mono"
                                    />
                                </label>
                            ))}
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <label className="text-xs flex items-center gap-1.5">
                                <span className="font-semibold text-gray-600">Correct:</span>
                                <select value={draftCorrect || ''}
                                    onChange={e => setDraftCorrect(e.target.value || null)}
                                    className="text-xs border border-gray-300 rounded px-2 py-0.5">
                                    <option value="">—</option>
                                    {['A', 'B', 'C', 'D'].map(k => <option key={k} value={k}>{k}</option>)}
                                </select>
                            </label>
                            <label className="text-xs flex items-center gap-1.5">
                                <span className="font-semibold text-gray-600">Difficulty:</span>
                                <select value={draftDifficulty ?? ''}
                                    onChange={e => setDraftDifficulty(e.target.value === '' ? null : Number(e.target.value))}
                                    className="text-xs border border-gray-300 rounded px-2 py-0.5">
                                    <option value="">—</option>
                                    <option value="1">1 — Easy</option>
                                    <option value="2">2 — Medium</option>
                                    <option value="3">3 — Hard</option>
                                    <option value="4">4 — Very Hard</option>
                                </select>
                            </label>
                            <div className="ml-auto flex items-center gap-2">
                                {editErr && <span className="text-xs text-red-600">{editErr}</span>}
                                <button onClick={cancelEdit} disabled={editBusy}
                                    className="px-3 py-1 text-xs font-semibold border border-gray-300 text-gray-700 bg-white rounded hover:bg-gray-50 disabled:opacity-50">
                                    Cancel
                                </button>
                                <button onClick={saveEdit} disabled={editBusy}
                                    className="px-3 py-1 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                                    {editBusy ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
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
// Tab: Topic Test — single-subtype 20Q drill (8 easy / 10 medium / 2 hard)
// =========================================================
function TopicTestPanel({ examId, onOpenMock }) {
    const [subtypes, setSubtypes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedSubtype, setSelectedSubtype] = useState('');
    const [selectedLevel, setSelectedLevel] = useState(1);
    const [creating, setCreating] = useState(false);
    const [result, setResult] = useState(null);
    const [feedback, setFeedback] = useState(null);

    const [maxPerSubtype, setMaxPerSubtype] = useState(3);
    const [bulkRunning, setBulkRunning] = useState(false);
    const [bulkResult, setBulkResult] = useState(null);

    const loadSubtypes = (level = selectedLevel) => {
        if (!examId) return;
        setLoading(true);
        fetch(`/api/topic-test/subtypes?exam_id=${examId}&difficulty_level=${level}`)
            .then(r => r.json())
            .then(d => setSubtypes(d.subtypes || []))
            .catch(() => setSubtypes([]))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        setSubtypes([]);
        setSelectedSubtype('');
        setResult(null);
        setFeedback(null);
        setBulkResult(null);
        loadSubtypes(selectedLevel);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [examId, selectedLevel]);

    const selected = subtypes.find(s => s.subtype === selectedSubtype);
    const poolOk = selected && selected.total_count >= 20;

    const eligibleForBulk = subtypes.filter(s => s.total_count >= 20).length;
    const projectedBulk = subtypes.reduce((s, x) => s + Math.min(maxPerSubtype, Math.floor(x.total_count / 20)), 0);

    const handleCreate = async () => {
        if (!selectedSubtype) return;
        setCreating(true);
        setFeedback(null);
        setResult(null);
        try {
            const res = await fetch('/api/topic-test/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exam_id: examId, subtype: selectedSubtype, difficulty_level: selectedLevel }),
            });
            const data = await res.json();
            if (!res.ok) {
                setFeedback({ type: 'error', msg: data.error || 'Failed to create topic test' });
                return;
            }
            setResult(data);
            setFeedback({ type: 'success', msg: `Created "${data.name}" — 20 questions ready for review.` });
            loadSubtypes(selectedLevel);
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setCreating(false);
        }
    };

    const [bulkProgress, setBulkProgress] = useState(null);

    const handleBulk = async () => {
        if (!examId) return;
        const candidates = subtypes.filter(s => s.total_count >= 20);
        if (candidates.length === 0) return;
        if (!confirm(`Generate up to ${maxPerSubtype} Topic test(s) per eligible subtype at Level ${LEVEL_LETTERS[selectedLevel]} (${candidates.length} subtypes). Continue?`)) return;

        setBulkRunning(true);
        setBulkResult(null);
        setFeedback(null);
        const created = [];
        const skipped = [];
        const totalAttempts = candidates.length * maxPerSubtype;
        let attemptIdx = 0;

        for (const cand of candidates) {
            const mocks = [];
            for (let i = 0; i < maxPerSubtype; i++) {
                attemptIdx += 1;
                setBulkProgress({
                    attempt: attemptIdx,
                    total: totalAttempts,
                    label: `${cand.subtype} (${i + 1}/${maxPerSubtype})`,
                });
                try {
                    const res = await fetch('/api/topic-test/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ exam_id: examId, subtype: cand.subtype, difficulty_level: selectedLevel }),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                        if (res.status === 409) {
                            if (i === 0) skipped.push({ subtype: cand.subtype, reason: data.error });
                            break;
                        }
                        skipped.push({ subtype: cand.subtype, reason: `After ${i} test(s): ${data.error}` });
                        break;
                    }
                    mocks.push({
                        mock_test_id: data.mock_test_id,
                        name: data.name,
                        section_code: data.section_code,
                        difficulty: data.stats?.difficulty,
                    });
                } catch (e) {
                    skipped.push({ subtype: cand.subtype, reason: `Network error: ${e.message}` });
                    break;
                }
            }
            if (mocks.length > 0) {
                created.push({ subtype: cand.subtype, count: mocks.length, mocks });
                setBulkResult({
                    total_created: created.reduce((s, c) => s + c.count, 0),
                    total_skipped: skipped.length,
                    created: [...created],
                    skipped: [...skipped],
                });
            }
        }

        const totalCreated = created.reduce((s, c) => s + c.count, 0);
        setBulkResult({
            total_created: totalCreated,
            total_skipped: skipped.length,
            created, skipped,
        });
        setBulkProgress(null);
        setFeedback({
            type: totalCreated > 0 ? 'success' : 'error',
            msg: totalCreated > 0
                ? `Created ${totalCreated} Topic test(s) across ${created.length} subtype(s).`
                : 'No Topic tests were created.',
        });
        loadSubtypes(selectedLevel);
        setBulkRunning(false);
    };

    return (
        <div className="space-y-5">
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-xs text-indigo-900">
                <div className="font-bold mb-1">Topic Test — 20 questions, single subtype</div>
                <div>
                    Difficulty mix depends on Level:{' '}
                    <strong>A</strong> = {LEVEL_MIX_LABEL[1]} (E/M/H),{' '}
                    <strong>B</strong> = {LEVEL_MIX_LABEL[2]},{' '}
                    <strong>C</strong> = {LEVEL_MIX_LABEL[3]}.
                    Named <code>Topic A1</code>, <code>Topic B1</code>, <code>Topic C1</code> — counter per level, shared across all exams whose profile matches.
                </div>
                <div className="mt-2 pt-2 border-t border-indigo-200 text-[11px] text-indigo-800">
                    Pool excludes questions already locked by other TOPIC tests at this level. Tests at different levels and other test types (FULL_MOCK, SECTION) keep the question eligible.
                </div>
            </div>

            {/* Level picker */}
            <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Difficulty level</label>
                <div className="flex gap-2 flex-wrap">
                    {[1, 2, 3].map(L => (
                        <button key={L} onClick={() => setSelectedLevel(L)}
                            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${selectedLevel === L ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            {LEVEL_LABELS[L]} — {LEVEL_MIX_LABEL[L]}
                        </button>
                    ))}
                </div>
            </div>

            {feedback && (
                <div className={`text-sm px-4 py-2 rounded ${feedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {feedback.msg}
                </div>
            )}

            {/* Single create */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Subtype</label>
                    {loading ? (
                        <div className="text-xs text-gray-400">Loading subtypes...</div>
                    ) : subtypes.length === 0 ? (
                        <div className="text-xs text-gray-400">No eligible subtypes found for this exam.</div>
                    ) : (
                        <select value={selectedSubtype} onChange={e => { setSelectedSubtype(e.target.value); setResult(null); setFeedback(null); }}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                            <option value="">Select a subtype...</option>
                            {subtypes.map(s => (
                                <option key={s.subtype} value={s.subtype}>
                                    {s.subtype} — {s.total_count} eligible ({s.best_section_code})
                                </option>
                            ))}
                        </select>
                    )}
                    {selected && (
                        <div className="text-xs text-gray-500 mt-1">
                            Section: <strong>{selected.best_section_code}</strong> · pool size:{' '}
                            <strong className={poolOk ? 'text-green-700' : 'text-red-700'}>{selected.total_count}</strong>
                            {!poolOk && <span className="text-red-700"> (need 20)</span>}
                        </div>
                    )}
                </div>

                <div className="flex items-end">
                    <button onClick={handleCreate} disabled={creating || !selectedSubtype || !poolOk}
                        className="w-full px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                        {creating ? 'Generating...' : 'Create Topic Test'}
                    </button>
                </div>
            </div>

            {/* Bulk panel */}
            <div className="border border-indigo-200 rounded-lg p-4 bg-white">
                <div className="text-sm font-semibold text-gray-900 mb-2">Generate All Topic Tests</div>
                <div className="text-xs text-gray-600 mb-3">
                    {eligibleForBulk} subtype{eligibleForBulk === 1 ? '' : 's'} with ≥20 eligible questions.
                    Projected output: <strong>{projectedBulk}</strong> Topic test{projectedBulk === 1 ? '' : 's'} at max {maxPerSubtype}/subtype.
                </div>
                <div className="flex items-end gap-3 flex-wrap">
                    <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Max per subtype</label>
                        <input type="number" min="1" max="10" value={maxPerSubtype}
                            onChange={e => setMaxPerSubtype(Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 10))}
                            className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <button onClick={handleBulk} disabled={bulkRunning || eligibleForBulk === 0}
                        className="px-5 py-2 text-sm font-semibold bg-indigo-700 text-white rounded-lg hover:bg-indigo-800 disabled:opacity-50">
                        {bulkRunning ? 'Running...' : 'Generate All'}
                    </button>
                </div>
                {bulkProgress && (
                    <div className="mt-3 text-xs text-indigo-800 bg-indigo-50 border border-indigo-200 rounded px-3 py-2">
                        Progress: {bulkProgress.attempt} / {bulkProgress.total} — {bulkProgress.label}
                    </div>
                )}
            </div>

            {result && (
                <div className="border border-green-200 bg-green-50 rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-bold text-green-900 flex items-center gap-2">
                                {result.name}
                                <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                                    Level {LEVEL_LETTERS[result.difficulty_level] || '?'}
                                </span>
                            </div>
                            <div className="text-xs text-green-800 mt-0.5">
                                Subtype: <strong>{result.subtype}</strong> · Section: <strong>{result.section_code}</strong> ·
                                Selected: <strong>{result.total_selected}/{result.total_target}</strong>
                            </div>
                            {result.stats?.difficulty && (
                                <div className="text-xs text-green-800 mt-1">
                                    Easy: <strong>{result.stats.difficulty.easy}</strong> · Medium: <strong>{result.stats.difficulty.medium}</strong> · Hard: <strong>{result.stats.difficulty.hard}</strong>
                                </div>
                            )}
                        </div>
                        <button onClick={() => onOpenMock(result.mock_test_id)}
                            className="px-4 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700">
                            Open for Review
                        </button>
                    </div>
                    {result.stats?.answer_balance && !result.stats.answer_balance.ok && (
                        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                            Answer balance warning: {(result.stats.answer_balance.issues || []).join('; ')}
                        </div>
                    )}
                </div>
            )}

            {bulkResult && (
                <div className="border border-green-200 bg-white rounded-lg p-4 space-y-3">
                    <div className="text-sm font-bold text-gray-900">
                        Bulk result: {bulkResult.total_created} created, {bulkResult.total_skipped} skipped
                    </div>
                    {bulkResult.created?.length > 0 && (
                        <div>
                            <div className="text-xs font-semibold text-gray-700 mb-1">Created</div>
                            <div className="space-y-1">
                                {bulkResult.created.map(c => (
                                    <div key={c.subtype} className="text-xs text-gray-800">
                                        <strong>{c.subtype}</strong> — {c.count} test{c.count === 1 ? '' : 's'}:{' '}
                                        {c.mocks.map((m, i) => (
                                            <button key={m.mock_test_id} onClick={() => onOpenMock(m.mock_test_id)}
                                                className="underline text-indigo-700 hover:text-indigo-900 mr-1">
                                                {m.name}{i < c.mocks.length - 1 ? ',' : ''}
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {bulkResult.skipped?.length > 0 && (
                        <div>
                            <div className="text-xs font-semibold text-gray-700 mb-1">Skipped</div>
                            <div className="space-y-1">
                                {bulkResult.skipped.map((s, i) => (
                                    <div key={i} className="text-xs text-gray-500">
                                        <strong>{s.subtype}</strong> — {s.reason}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// =========================================================
// Tab: Section Test — full-section mixed-subtype practice
// =========================================================
function SectionTestPanel({ examId, onOpenMock }) {
    const [sections, setSections] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedCode, setSelectedCode] = useState('');
    const [selectedLevel, setSelectedLevel] = useState(1);
    const [creating, setCreating] = useState(false);
    const [result, setResult] = useState(null);
    const [feedback, setFeedback] = useState(null);

    const [maxPerSection, setMaxPerSection] = useState(3);
    const [bulkRunning, setBulkRunning] = useState(false);
    const [bulkResult, setBulkResult] = useState(null);

    const loadSections = (level = selectedLevel) => {
        if (!examId) return;
        setLoading(true);
        fetch(`/api/section-test/sections?exam_id=${examId}&difficulty_level=${level}`)
            .then(r => r.json())
            .then(d => setSections(d.sections || []))
            .catch(() => setSections([]))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        setSections([]);
        setSelectedCode('');
        setResult(null);
        setFeedback(null);
        setBulkResult(null);
        loadSections(selectedLevel);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [examId, selectedLevel]);

    const selected = sections.find(s => s.code === selectedCode);
    const poolOk = selected && selected.pool_size >= selected.target;

    const handleCreate = async () => {
        if (!selectedCode) return;
        setCreating(true);
        setFeedback(null);
        setResult(null);
        try {
            const res = await fetch('/api/section-test/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exam_id: examId, section_code: selectedCode, difficulty_level: selectedLevel }),
            });
            const data = await res.json();
            if (!res.ok) {
                setFeedback({ type: 'error', msg: data.error || 'Failed to create section test' });
                return;
            }
            setResult(data);
            setFeedback({ type: 'success', msg: `Created "${data.name}" — ${data.total_selected} questions.` });
            loadSections(selectedLevel);
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setCreating(false);
        }
    };

    const [bulkProgress, setBulkProgress] = useState(null);

    const handleBulk = async () => {
        if (!examId) return;
        const candidates = sections.filter(s => s.tests_possible > 0);
        if (candidates.length === 0) return;
        if (!confirm(`Generate up to ${maxPerSection} Section test(s) per section at Level ${LEVEL_LETTERS[selectedLevel]} (${candidates.length} sections). Continue?`)) return;

        setBulkRunning(true);
        setBulkResult(null);
        setFeedback(null);
        const created = [];
        const skipped = [];
        const totalAttempts = candidates.length * maxPerSection;
        let attemptIdx = 0;

        for (const cand of candidates) {
            const mocks = [];
            for (let i = 0; i < maxPerSection; i++) {
                attemptIdx += 1;
                setBulkProgress({
                    attempt: attemptIdx,
                    total: totalAttempts,
                    label: `${cand.code} (${i + 1}/${maxPerSection})`,
                });
                try {
                    const res = await fetch('/api/section-test/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ exam_id: examId, section_code: cand.code, difficulty_level: selectedLevel }),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                        if (res.status === 409) {
                            if (i === 0) skipped.push({ section_code: cand.code, reason: data.error });
                            break;
                        }
                        skipped.push({ section_code: cand.code, reason: `After ${i} test(s): ${data.error}` });
                        break;
                    }
                    mocks.push({
                        mock_test_id: data.mock_test_id,
                        name: data.name,
                        section_code: data.section_code,
                        target: data.total_target,
                        selected: data.total_selected,
                    });
                } catch (e) {
                    skipped.push({ section_code: cand.code, reason: `Network error: ${e.message}` });
                    break;
                }
            }
            if (mocks.length > 0) {
                created.push({ section_code: cand.code, count: mocks.length, mocks });
                setBulkResult({
                    total_created: created.reduce((s, c) => s + c.count, 0),
                    total_skipped: skipped.length,
                    created: [...created],
                    skipped: [...skipped],
                });
            }
        }

        const totalCreated = created.reduce((s, c) => s + c.count, 0);
        setBulkResult({
            total_created: totalCreated,
            total_skipped: skipped.length,
            created, skipped,
        });
        setBulkProgress(null);
        setFeedback({
            type: totalCreated > 0 ? 'success' : 'error',
            msg: totalCreated > 0
                ? `Created ${totalCreated} Section test(s) across ${created.length} section(s).`
                : 'No Section tests were created.',
        });
        loadSections(selectedLevel);
        setBulkRunning(false);
    };

    const eligibleSections = sections.filter(s => s.tests_possible > 0).length;
    const projectedBulk = sections.reduce((s, x) => s + Math.min(maxPerSection, x.tests_possible || 0), 0);

    return (
        <div className="space-y-5">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-xs text-emerald-900">
                <div className="font-bold mb-1">Section Test — full section, mixed subtypes</div>
                <div>
                    Size matches the section's normal length. Subtype mix is <strong>cap-2-then-proportional</strong>.
                    Difficulty mix depends on Level:{' '}
                    <strong>A</strong> = {LEVEL_MIX_LABEL[1]} (E/M/H),{' '}
                    <strong>B</strong> = {LEVEL_MIX_LABEL[2]},{' '}
                    <strong>C</strong> = {LEVEL_MIX_LABEL[3]}.
                    Named <code>Quant A1</code>, <code>Reasoning B1</code> etc. — counter per (section, level), shared across exams whose profile matches.
                </div>
                <div className="mt-2 pt-2 border-t border-emerald-200 text-[11px] text-emerald-800">
                    Pool excludes questions already locked by other SECTION tests at this level. Tests at different levels and other test types (TOPIC, FULL_MOCK) keep the question eligible.
                </div>
            </div>

            {/* Level picker */}
            <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Difficulty level</label>
                <div className="flex gap-2 flex-wrap">
                    {[1, 2, 3].map(L => (
                        <button key={L} onClick={() => setSelectedLevel(L)}
                            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${selectedLevel === L ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            {LEVEL_LABELS[L]} — {LEVEL_MIX_LABEL[L]}
                        </button>
                    ))}
                </div>
            </div>

            {feedback && (
                <div className={`text-sm px-4 py-2 rounded ${feedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {feedback.msg}
                </div>
            )}

            {/* Single create */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Section</label>
                    {loading ? (
                        <div className="text-xs text-gray-400">Loading sections...</div>
                    ) : sections.length === 0 ? (
                        <div className="text-xs text-gray-400">No sections found for this exam.</div>
                    ) : (
                        <select value={selectedCode} onChange={e => { setSelectedCode(e.target.value); setResult(null); setFeedback(null); }}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500">
                            <option value="">Select a section...</option>
                            {sections.map(s => (
                                <option key={s.code} value={s.code}>
                                    {s.code} ({s.name}) — pool {s.pool_size}, can build {s.tests_possible}, target {s.target}
                                </option>
                            ))}
                        </select>
                    )}
                    {selected && (
                        <div className="text-xs text-gray-500 mt-1">
                            Section: <strong>{selected.code}</strong> · pool:{' '}
                            <strong className={poolOk ? 'text-green-700' : 'text-red-700'}>{selected.pool_size}</strong>{' '}
                            / target <strong>{selected.target}</strong>
                            {!poolOk && <span className="text-red-700"> (not enough)</span>}
                        </div>
                    )}
                </div>

                <div className="flex items-end">
                    <button onClick={handleCreate} disabled={creating || !selectedCode || !poolOk}
                        className="w-full px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                        {creating ? 'Generating...' : 'Create Section Test'}
                    </button>
                </div>
            </div>

            {/* Bulk panel */}
            <div className="border border-emerald-200 rounded-lg p-4 bg-white">
                <div className="text-sm font-semibold text-gray-900 mb-2">Generate All Section Tests</div>
                <div className="text-xs text-gray-600 mb-3">
                    {eligibleSections} section{eligibleSections === 1 ? '' : 's'} with enough pool.
                    Projected output: <strong>{projectedBulk}</strong> Section test{projectedBulk === 1 ? '' : 's'} at max {maxPerSection}/section.
                </div>
                <div className="flex items-end gap-3 flex-wrap">
                    <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Max per section</label>
                        <input type="number" min="1" max="10" value={maxPerSection}
                            onChange={e => setMaxPerSection(Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 10))}
                            className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <button onClick={handleBulk} disabled={bulkRunning || eligibleSections === 0}
                        className="px-5 py-2 text-sm font-semibold bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50">
                        {bulkRunning ? 'Running...' : 'Generate All'}
                    </button>
                </div>
                {bulkProgress && (
                    <div className="mt-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                        Progress: {bulkProgress.attempt} / {bulkProgress.total} — {bulkProgress.label}
                    </div>
                )}
            </div>

            {result && (
                <div className="border border-green-200 bg-green-50 rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-bold text-green-900 flex items-center gap-2">
                                {result.name}
                                <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                                    Level {LEVEL_LETTERS[result.difficulty_level] || '?'}
                                </span>
                            </div>
                            <div className="text-xs text-green-800 mt-0.5">
                                Section: <strong>{result.section_code}</strong> ·
                                Selected: <strong>{result.total_selected}/{result.total_target}</strong>
                            </div>
                            {result.stats?.difficulty && (
                                <div className="text-xs text-green-800 mt-1">
                                    Easy: <strong>{result.stats.difficulty.easy}</strong> · Medium: <strong>{result.stats.difficulty.medium}</strong> · Hard: <strong>{result.stats.difficulty.hard}</strong>
                                </div>
                            )}
                            {result.stats?.subtype_distribution && (
                                <div className="text-[11px] text-green-800 mt-1">
                                    Subtypes: {Object.entries(result.stats.subtype_distribution).map(([k, v]) => `${k}(${v})`).join(', ')}
                                </div>
                            )}
                        </div>
                        <button onClick={() => onOpenMock(result.mock_test_id)}
                            className="px-4 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700">
                            Open for Review
                        </button>
                    </div>
                </div>
            )}

            {bulkResult && (
                <div className="border border-green-200 bg-white rounded-lg p-4 space-y-3">
                    <div className="text-sm font-bold text-gray-900">
                        Bulk result: {bulkResult.total_created} created, {bulkResult.total_skipped} skipped
                    </div>
                    {bulkResult.created?.length > 0 && (
                        <div>
                            <div className="text-xs font-semibold text-gray-700 mb-1">Created</div>
                            <div className="space-y-1">
                                {bulkResult.created.map(c => (
                                    <div key={c.section_code} className="text-xs text-gray-800">
                                        <strong>{c.section_code}</strong> — {c.count} test{c.count === 1 ? '' : 's'}:{' '}
                                        {c.mocks.map((m, i) => (
                                            <button key={m.mock_test_id} onClick={() => onOpenMock(m.mock_test_id)}
                                                className="underline text-emerald-700 hover:text-emerald-900 mr-1">
                                                {m.name}{i < c.mocks.length - 1 ? ',' : ''}
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {bulkResult.skipped?.length > 0 && (
                        <div>
                            <div className="text-xs font-semibold text-gray-700 mb-1">Skipped</div>
                            <div className="space-y-1">
                                {bulkResult.skipped.map((s, i) => (
                                    <div key={i} className="text-xs text-gray-500">
                                        <strong>{s.section_code}</strong> — {s.reason}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// =========================================================
// Tab: Export PYQs (download as JSON for cloning / re-ingest)
// =========================================================
function ExportPyqsPanel({ examId, examName }) {
    const [years, setYears] = useState([]);
    const [yearsLoading, setYearsLoading] = useState(false);
    const [year, setYear] = useState('');
    const [count, setCount] = useState(5);
    const [splitFiles, setSplitFiles] = useState(true);
    const [downloading, setDownloading] = useState(false);
    const [feedback, setFeedback] = useState(null);

    useEffect(() => {
        if (!examId) return;
        setYearsLoading(true);
        setYear('');
        fetch(`/api/mock-blueprint/available-years?exam_id=${examId}`)
            .then(r => r.json())
            .then(d => {
                setYears(d.years || []);
                if (d.years?.length > 0) setYear(String(d.years[0].year));
            })
            .catch(() => setYears([]))
            .finally(() => setYearsLoading(false));
    }, [examId]);

    const slugify = s => (s || 'exam').toString().replace(/[^a-zA-Z0-9]+/g, '-').replace(/(^-|-$)/g, '').toLowerCase();

    const triggerDownload = (filename, dataObj) => {
        const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const handleDownload = async () => {
        if (!year) return;
        setDownloading(true);
        setFeedback(null);
        try {
            const res = await fetch(`/api/pyq/export?exam_id=${examId}&year=${year}&limit=${count}`);
            const data = await res.json();
            if (!res.ok) {
                setFeedback({ type: 'error', msg: data.error || 'Failed to fetch PYQs' });
                return;
            }
            const examSlug = slugify(examName || data.export_meta?.exam_name);
            const papers = data.papers || [];

            if (papers.length === 0) {
                setFeedback({ type: 'error', msg: 'No papers returned for this exam/year.' });
                return;
            }

            if (splitFiles) {
                // One JSON per paper. Browser may prompt for "allow multiple downloads" first time.
                for (let i = 0; i < papers.length; i++) {
                    const paper = papers[i];
                    const date = (paper.paper_meta?.paper_date || '').slice(0, 10);
                    const lbl = slugify(paper.paper_meta?.session_label || paper.paper_meta?.paper_session_id);
                    const fname = `${examSlug}_${year}_${date || i + 1}_${lbl}.json`;
                    triggerDownload(fname, paper);
                    // small stagger so browser doesn't drop downloads
                    await new Promise(r => setTimeout(r, 250));
                }
            } else {
                triggerDownload(`${examSlug}_${year}_${papers.length}papers.json`, data);
            }

            setFeedback({
                type: 'success',
                msg: `Downloaded ${papers.length} paper${papers.length === 1 ? '' : 's'} (requested ${data.export_meta?.requested_papers}).`,
            });
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="space-y-5">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-900">
                <div className="font-bold mb-1">PYQ Export — for local cloning + re-ingest</div>
                <div>
                    Each paper is exported as JSON containing every <code>*_json</code> column verbatim
                    (<code>raw.en</code>, <code>raw.hi</code>) plus extracted text (<code>clone.en</code>,
                    <code>clone.hi</code>) so a local LLM can read the questions directly. For organised
                    folder downloads (<code>{`<exam>/<year>/<paper>.json`}</code>) run
                    <code className="mx-1">scripts/download_pyqs.py</code> with your session cookie.
                </div>
                <div className="mt-2 pt-2 border-t border-amber-200 text-[11px] text-amber-800">
                    <strong>Active filters:</strong> solution_status = DONE &middot; has_image = false &middot; status = MANUALLY_CORRECTED.
                    Image questions and unsolved questions are skipped.
                </div>
                <div className="mt-1 text-[11px] text-amber-800">
                    Each paper carries <code>paper_meta.source_pdf_path</code> + <code>paper_meta.pdf_url</code> (the same <code>/api/pdf?path=…</code> link the bilingual/test pages use).
                    Run the script with <code>--download-pdfs</code> to save PDFs alongside the JSONs.
                </div>
            </div>

            {feedback && (
                <div className={`text-sm px-4 py-2 rounded ${feedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {feedback.msg}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Year</label>
                    {yearsLoading ? (
                        <div className="text-xs text-gray-400">Loading years...</div>
                    ) : years.length === 0 ? (
                        <div className="text-xs text-gray-400">No PYQ years found for this exam.</div>
                    ) : (
                        <select value={year} onChange={e => setYear(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                            {years.map(y => (
                                <option key={y.year} value={y.year}>
                                    {y.year} — {y.paper_count} papers, {y.question_count} questions
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Number of papers</label>
                    <input type="number" min="1" max="50" value={count}
                        onChange={e => setCount(Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 50))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                    <div className="text-xs text-gray-400 mt-1">Max 50. Most-recent papers first.</div>
                </div>

                <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Format</label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={splitFiles}
                            onChange={e => setSplitFiles(e.target.checked)} className="accent-blue-600" />
                        One file per paper
                    </label>
                    <div className="text-xs text-gray-400 mt-1">
                        {splitFiles ? 'Browser may ask "allow multiple downloads"' : 'Single combined manifest JSON'}
                    </div>
                </div>
            </div>

            <div>
                <button onClick={handleDownload} disabled={downloading || !year}
                    className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {downloading ? 'Downloading...' : `Download ${count} paper${count === 1 ? '' : 's'}`}
                </button>
            </div>
        </div>
    );
}

// =========================================================
// Main Manager Component
// =========================================================
export default function MockTestManager({ exams }) {
    const [selectedExamId, setSelectedExamId] = useState('');
    const [activeTab, setActiveTab] = useState('mocks'); // 'mocks' | 'create' | 'topic' | 'section' | 'export'
    const [reviewingMockId, setReviewingMockId] = useState(null);

    if (reviewingMockId) {
        return <MockReview mockTestId={reviewingMockId} onBack={() => setReviewingMockId(null)} />;
    }

    const selectedExam = exams.find(e => e.exam_id === selectedExamId);
    const tabLabels = { mocks: 'Existing Mocks', create: 'Create New', topic: 'Topic Test', section: 'Section Test', export: 'Export PYQs' };

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
                            {['mocks', 'create', 'topic', 'section', 'export'].map(tab => (
                                <button key={tab} onClick={() => setActiveTab(tab)}
                                    className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                    {tabLabels[tab]}
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
                ) : activeTab === 'create' ? (
                    <BlueprintPanel examId={selectedExamId} />
                ) : activeTab === 'topic' ? (
                    <TopicTestPanel examId={selectedExamId} onOpenMock={setReviewingMockId} />
                ) : activeTab === 'section' ? (
                    <SectionTestPanel examId={selectedExamId} onOpenMock={setReviewingMockId} />
                ) : (
                    <ExportPyqsPanel examId={selectedExamId} examName={selectedExam?.name} />
                )}
            </div>
        </div>
    );
}
