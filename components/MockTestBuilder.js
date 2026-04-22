'use client';

import { useState, useEffect, useCallback } from 'react';
import Latex from '@/components/Latex';

const DIFF = [
    { value: 1, label: 'Easy',   cls: 'bg-green-100 text-green-700 border-green-200' },
    { value: 2, label: 'Medium', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
    { value: 3, label: 'Hard',   cls: 'bg-red-100 text-red-700 border-red-200' },
];

function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short' });
}

// Normalise a question for the edit form — solution_text may be nested in solution_json
function normaliseQ(q) {
    if (!q) return q;
    return {
        ...q,
        solution_text: q.solution_json?.solution_text ?? q.solution_json?.explanation ?? '',
        difficulty:    q.slot_difficulty ?? q.difficulty,
    };
}

// ─── Left: Candidate panel ────────────────────────────────────────────────────
function CandidatePanel({ mockTestId, targetExamId, onAccepted, acceptedIds }) {
    const [subtype, setSubtype]             = useState('');
    const [subtypes, setSubtypes]           = useState([]);
    const [question, setQuestion]           = useState(null);
    const [poolRemaining, setPoolRemaining] = useState(null);
    const [loading, setLoading]             = useState(false);
    const [done, setDone]                   = useState(false);
    const [accepting, setAccepting]         = useState(false);
    const [seenIds, setSeenIds]             = useState([]);
    const [sectionId, setSectionId]         = useState('');
    const [sections, setSections]           = useState([]);
    // Blueprint bulk-load
    const [blueprints, setBlueprints]       = useState([]);
    const [bulkQueue, setBulkQueue]         = useState([]); // pre-loaded questions
    const [bulkLoading, setBulkLoading]     = useState(false);

    // Load sections for the target exam (to know where to slot the question)
    useEffect(() => {
        if (!targetExamId) return;
        fetch(`/api/mock-test/builder/sections?exam_id=${targetExamId}&mock_test_id=${mockTestId}`)
            .then(r => r.json())
            .then(d => {
                setSections(d.sections || []);
                setSectionId(d.sections?.[0]?.section_id || '');
            })
            .catch(() => {});
        // Load blueprints for this exam
        fetch(`/api/mock-test/blueprint/list?exam_id=${targetExamId}`)
            .then(r => r.json())
            .then(d => setBlueprints(d.blueprints || []))
            .catch(() => {});
    }, [targetExamId, mockTestId]);

    // Load cross-exam subtypes
    useEffect(() => {
        if (!targetExamId) return;
        fetch(`/api/mock-test/builder/session?mock_test_id=${mockTestId}&section_id=_&exam_id=${targetExamId}`)
            .then(r => r.json())
            .then(d => setSubtypes(d.subtypes || []))
            .catch(() => {});
    }, [targetExamId, mockTestId]);

    // Reset when subtype changes
    useEffect(() => {
        setQuestion(null);
        setDone(false);
        setSeenIds([]);
        setPoolRemaining(null);
    }, [subtype]);

    const fetchNext = useCallback(async (extraExclude = []) => {
        if (!targetExamId) return;
        setLoading(true);
        try {
            const allExclude = [...new Set([...seenIds, ...acceptedIds, ...extraExclude])];
            const res = await fetch('/api/mock-test/builder/candidate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mock_test_id: mockTestId,
                    target_exam_id: targetExamId,
                    subtype: subtype || undefined,
                    exclude_ids: allExclude,
                }),
            });
            const data = await res.json();
            if (data.done) { setDone(true); setQuestion(null); }
            else {
                setQuestion(data.question);
                setPoolRemaining(data.pool_remaining);
                setSeenIds(prev => [...new Set([...prev, data.question.question_id])]);
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [targetExamId, mockTestId, subtype, seenIds, acceptedIds]);

    // Load all candidates for a blueprint section in one shot
    const handleLoadBlueprint = async (blueprintId, targetSectionId) => {
        const bp = blueprints.find(b => b.blueprint_id === blueprintId);
        if (!bp) return;
        const section = (bp.config_json?.sections || []).find(s => s.section_id === targetSectionId);
        if (!section?.topic_slots?.length) { alert('No slots defined for this section in the blueprint'); return; }
        setBulkLoading(true);
        try {
            const res = await fetch('/api/mock-test/builder/bulk-candidates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mock_test_id: mockTestId,
                    target_exam_id: targetExamId,
                    slots: section.topic_slots.map(t => ({ subtype: t.subtype, count: t.count, difficulty: t.difficulty || undefined })),
                }),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Load failed'); return; }
            const allQ = data.results.flatMap(r => r.questions.map(q => ({ ...q, _targetSection: targetSectionId })));
            setBulkQueue(allQ);
            if (allQ.length > 0) {
                setQuestion(allQ[0]);
                setSectionId(targetSectionId);
                setSeenIds(allQ.map(q => q.question_id));
            }
        } finally { setBulkLoading(false); }
    };

    // Advance bulk queue to next
    const advanceBulkQueue = () => {
        if (bulkQueue.length <= 1) { setBulkQueue([]); setQuestion(null); setDone(true); return; }
        const [, ...rest] = bulkQueue;
        setBulkQueue(rest);
        setQuestion(rest[0]);
    };

    const handleAccept = async () => {
        if (!question || !sectionId) { alert('Select a section first'); return; }
        setAccepting(true);
        try {
            const res = await fetch('/api/mock-test/builder/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mock_test_id: mockTestId, source_question_id: question.question_id, section_id: sectionId }),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Failed to accept'); return; }
            // Use the new copied question_id returned by the API
            onAccepted({ ...question, question_id: data.new_question_id, section_id: sectionId, exam_section_id: sectionId });
            if (bulkQueue.length > 0) advanceBulkQueue();
            else fetchNext([question.question_id]);
        } finally { setAccepting(false); }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Section</span>
                    <select value={sectionId} onChange={e => { setSectionId(e.target.value); setBulkQueue([]); }}
                        className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400">
                        {sections.map(s => <option key={s.section_id} value={s.section_id}>{s.code}</option>)}
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Subtype</span>
                    <select value={subtype} onChange={e => { setSubtype(e.target.value); setBulkQueue([]); }}
                        className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400">
                        <option value="">All</option>
                        {subtypes.map(s => <option key={s.subtype} value={s.subtype}>{s.subtype} ({s.cnt})</option>)}
                    </select>
                </div>
                {blueprints.length > 0 && sectionId && (
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-500">Blueprint</span>
                        <select defaultValue="" onChange={e => e.target.value && handleLoadBlueprint(e.target.value, sectionId)}
                            className="text-xs border border-indigo-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 text-indigo-700">
                            <option value="">Load...</option>
                            {blueprints.map(b => <option key={b.blueprint_id} value={b.blueprint_id}>{b.name}</option>)}
                        </select>
                        {bulkQueue.length > 0 && (
                            <span className="text-xs text-indigo-600 font-semibold">{bulkQueue.length} queued</span>
                        )}
                    </div>
                )}
                {poolRemaining !== null && !bulkQueue.length && (
                    <span className="ml-auto text-xs text-gray-400">{poolRemaining} in pool</span>
                )}
                {bulkLoading && <span className="ml-auto text-xs text-indigo-400 animate-pulse">Loading blueprint...</span>}
            </div>

            {/* Question area */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
                {!question && !loading && !done && (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                        <p className="text-sm text-gray-400">Questions drawn from other exams matching subtype</p>
                        <button onClick={() => fetchNext()}
                            className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
                            Load First Candidate
                        </button>
                    </div>
                )}
                {loading && <div className="flex items-center justify-center h-full text-gray-400 text-sm animate-pulse">Loading...</div>}
                {done && !loading && (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                        No more candidates{subtype ? ` for subtype "${subtype}"` : ''}.
                    </div>
                )}

                {question && !loading && (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            {question.source_exam && (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100">
                                    {question.source_exam_code || question.source_exam}
                                </span>
                            )}
                            {question.subtype && (
                                <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">{question.subtype}</span>
                            )}
                            <span className="text-xs text-gray-400">
                                Q.{question.source_question_no || '?'} · {question.source_session} · {formatDate(question.source_date)}
                            </span>
                        </div>

                        <div className="text-sm text-gray-900 leading-relaxed">
                            <Latex>{question.question_text || ''}</Latex>
                        </div>

                        <div className="space-y-1.5">
                            {(question.options || []).map(opt => (
                                <div key={opt.option_key}
                                    className={`flex items-start gap-2.5 px-3 py-2 rounded-lg text-sm border ${
                                        opt.option_key === question.correct_option_label
                                            ? 'border-green-300 bg-green-50 text-green-900'
                                            : 'border-gray-100 bg-white text-gray-700'
                                    }`}>
                                    <span className="font-bold shrink-0 w-5 text-center">{opt.option_key}</span>
                                    <Latex>{opt.text || '—'}</Latex>
                                    {opt.option_key === question.correct_option_label && <span className="ml-auto text-green-600 shrink-0">✓</span>}
                                </div>
                            ))}
                        </div>

                        {question.solution_json?.solution_text && (
                            <div className="px-3 py-2 bg-amber-50 border border-amber-100 rounded text-xs text-amber-800">
                                <span className="font-semibold">Solution: </span>
                                {question.solution_json.solution_text}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {question && !loading && (
                <div className="px-4 py-3 border-t border-gray-100 flex gap-3">
                    <button onClick={handleAccept} disabled={accepting || !sectionId}
                        className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50">
                        {accepting ? 'Adding...' : '✓ Accept'}
                    </button>
                    <button onClick={() => bulkQueue.length > 0 ? advanceBulkQueue() : fetchNext()} disabled={loading}
                        className="flex-1 py-2.5 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                        → Skip
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Right: Accepted — scrollable list with inline edit ───────────────────────
function AcceptedPanel({ mockTestId, sections, accepted, onRemoved, onUpdated }) {
    const [expandedId, setExpandedId] = useState(null);
    const [editStates, setEditStates] = useState({});   // question_id → edit fields
    const [saving, setSaving]         = useState(null); // question_id currently saving
    const [removing, setRemoving]     = useState(null);

    // Auto-expand the most recently accepted question
    useEffect(() => {
        if (accepted.length > 0) {
            const last = accepted[accepted.length - 1];
            if (!editStates[last.question_id]) initEdit(last);
            setExpandedId(last.question_id);
        }
    }, [accepted.length]); // eslint-disable-line react-hooks/exhaustive-deps

    function initEdit(q) {
        const merged = normaliseQ(q);
        setEditStates(prev => ({
            ...prev,
            [q.question_id]: {
                question_text:  merged.question_text  || '',
                options:        (merged.options || []).map(o => ({ key: o.option_key, text: o.text || '' })),
                correct_option: merged.correct_option_label || '',
                solution_text:  merged.solution_text  || '',
                difficulty:     merged.difficulty     || null,
            },
        }));
    }

    const toggleExpand = (q) => {
        if (expandedId === q.question_id) { setExpandedId(null); return; }
        if (!editStates[q.question_id]) initEdit(q);
        setExpandedId(q.question_id);
    };

    const setField = (qId, patch) =>
        setEditStates(prev => ({ ...prev, [qId]: { ...prev[qId], ...patch } }));

    const handleSave = async (questionId) => {
        const es = editStates[questionId];
        if (!es) return;
        setSaving(questionId);
        try {
            const res = await fetch('/api/mock-test/builder/override', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mock_test_id: mockTestId, question_id: questionId, ...es }),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Save failed'); return; }
            onUpdated(questionId, es);
        } finally { setSaving(null); }
    };

    const handleRemove = async (questionId) => {
        if (!confirm('Remove this question?')) return;
        setRemoving(questionId);
        try {
            const res = await fetch('/api/mock-test/builder/accept', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mock_test_id: mockTestId, question_id: questionId }),
            });
            if (res.ok) {
                if (expandedId === questionId) setExpandedId(null);
                setEditStates(prev => { const n = { ...prev }; delete n[questionId]; return n; });
                onRemoved(questionId);
            } else alert('Failed to remove');
        } finally { setRemoving(null); }
    };

    if (accepted.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                Accept a question to see it here
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {accepted.map((q, i) => {
                const merged   = normaliseQ(q);
                const isOpen   = expandedId === q.question_id;
                const es       = editStates[q.question_id];
                const diff     = DIFF.find(d => d.value === merged.difficulty);
                const section  = sections.find(s => s.section_id === (q.exam_section_id || q.section_id));

                return (
                    <div key={q.question_id} className={isOpen ? 'bg-indigo-50/40' : ''}>
                        {/* ── Collapsed row (always visible) ── */}
                        <div
                            className="px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
                            onClick={() => toggleExpand(q)}
                        >
                            <span className="text-xs font-bold text-gray-400 w-5 shrink-0 pt-0.5">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                    {section && (
                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                                            {section.code}
                                        </span>
                                    )}
                                    {merged.subtype && (
                                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded">
                                            {merged.subtype}
                                        </span>
                                    )}
                                    {diff && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${diff.cls}`}>
                                            {diff.label}
                                        </span>
                                    )}
                                    {q.source_exam && (
                                        <span className="text-[10px] text-gray-400">
                                            {q.source_exam_code || q.source_exam}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-gray-700 leading-relaxed line-clamp-2">
                                    {merged.question_text || '—'}
                                </p>
                            </div>
                            <span className="text-gray-300 text-[10px] shrink-0 pt-1">{isOpen ? '▲' : '▼'}</span>
                        </div>

                        {/* ── Expanded inline edit form ── */}
                        {isOpen && es && (
                            <div className="px-4 pb-5 space-y-4 border-t border-indigo-100">
                                {/* Meta row */}
                                <div className="flex items-center gap-2 pt-3 text-xs text-gray-400">
                                    <span>From {q.source_exam} · {q.source_session}</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleRemove(q.question_id); }}
                                        disabled={removing === q.question_id}
                                        className="ml-auto text-red-400 hover:text-red-600 disabled:opacity-50">
                                        Remove
                                    </button>
                                </div>

                                {/* Difficulty */}
                                <div className="flex gap-2">
                                    {DIFF.map(d => (
                                        <button key={d.value}
                                            onClick={() => setField(q.question_id, { difficulty: d.value })}
                                            className={`px-3 py-1.5 rounded border text-xs font-semibold transition-colors ${
                                                es.difficulty === d.value
                                                    ? d.cls + ' ring-2 ring-offset-1 ring-current'
                                                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                            }`}>
                                            {d.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Question text */}
                                <textarea
                                    value={es.question_text}
                                    onChange={e => setField(q.question_id, { question_text: e.target.value })}
                                    rows={3}
                                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-y font-mono"
                                />

                                {/* Options */}
                                <div className="space-y-1.5">
                                    {es.options.map((opt, oi) => (
                                        <div key={opt.key} className="flex items-center gap-2">
                                            <button
                                                onClick={() => setField(q.question_id, { correct_option: opt.key })}
                                                className={`shrink-0 w-6 h-6 rounded-full border-2 text-xs font-bold transition-colors ${
                                                    es.correct_option === opt.key
                                                        ? 'bg-green-500 border-green-500 text-white'
                                                        : 'border-gray-300 text-gray-400 hover:border-green-400'
                                                }`}>
                                                {opt.key}
                                            </button>
                                            <input
                                                type="text"
                                                value={opt.text}
                                                onChange={e => setField(q.question_id, {
                                                    options: es.options.map((o, j) => j === oi ? { ...o, text: e.target.value } : o),
                                                })}
                                                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                            />
                                        </div>
                                    ))}
                                </div>

                                {/* Solution */}
                                <textarea
                                    value={es.solution_text}
                                    onChange={e => setField(q.question_id, { solution_text: e.target.value })}
                                    rows={3}
                                    placeholder="Solution explanation..."
                                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-y"
                                />

                                <button
                                    onClick={() => handleSave(q.question_id)}
                                    disabled={saving === q.question_id}
                                    className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50">
                                    {saving === q.question_id ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function MockTestBuilder({ mockTests, exams, testType = 'MOCK', migrationPending = false }) {
    const [selectedMockTestId, setSelectedMockTestId] = useState(mockTests[0]?.mock_test_id || '');
    const [accepted, setAccepted]     = useState([]);
    const [sections, setSections]     = useState([]);
    const [sectionCounts, setSectionCounts] = useState({});
    const [creatingTest, setCreatingTest]   = useState(false);
    const [newTestName, setNewTestName]     = useState('');
    const [newTestExamId, setNewTestExamId] = useState(exams[0]?.exam_id || '');

    const mockTest = mockTests.find(m => m.mock_test_id === selectedMockTestId);

    // Load sections + accepted counts when mock test changes
    useEffect(() => {
        if (!selectedMockTestId || !mockTest) return;
        fetch(`/api/mock-test/builder/sections?exam_id=${mockTest.exam_id}&mock_test_id=${selectedMockTestId}`)
            .then(r => r.json())
            .then(d => { setSections(d.sections || []); setSectionCounts(d.counts || {}); })
            .catch(() => {});
        // Also load all accepted questions for this mock test
        // (we don't scope to a section in the main state — AcceptedPanel handles section filtering)
        fetch(`/api/mock-test/builder/session?mock_test_id=${selectedMockTestId}&section_id=all&exam_id=${mockTest.exam_id}`)
            .then(r => r.json())
            .then(d => setAccepted(d.accepted || []))
            .catch(() => {});
    }, [selectedMockTestId]);

    const handleAccepted = (q) => {
        setAccepted(prev => [...prev, q]);
        setSectionCounts(prev => ({ ...prev, [q.section_id]: (prev[q.section_id] || 0) + 1 }));
    };

    const handleRemoved = (questionId) => {
        const q = accepted.find(a => a.question_id === questionId);
        setAccepted(prev => prev.filter(a => a.question_id !== questionId));
        if (q) setSectionCounts(prev => ({ ...prev, [q.exam_section_id || q.section_id]: Math.max(0, (prev[q.exam_section_id || q.section_id] || 1) - 1) }));
    };

    const handleUpdated = (questionId, edits) => {
        setAccepted(prev => prev.map(q => q.question_id === questionId
            ? { ...q, ...edits, solution_json: { ...(q.solution_json || {}), solution_text: edits.solution_text } }
            : q
        ));
    };

    const handleCreateTest = async () => {
        if (!newTestName.trim() || !newTestExamId) return;
        setCreatingTest(true);
        try {
            const res = await fetch('/api/mock-test/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newTestName.trim(), exam_id: newTestExamId, type: testType }),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Failed to create'); return; }
            window.location.reload();
        } finally { setCreatingTest(false); }
    };

    const acceptedIds = accepted.map(q => q.question_id);

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            {migrationPending && (
                <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-800 font-medium flex items-center gap-2">
                    <span>⚠ Database migration required before creating section tests. Run on Supabase:</span>
                    <code className="bg-amber-100 px-2 py-0.5 rounded font-mono">
                        ALTER TABLE mock_test ADD COLUMN IF NOT EXISTS type TEXT DEFAULT &apos;MOCK&apos; CHECK (type IN (&apos;MOCK&apos;, &apos;SECTION&apos;));
                    </code>
                </div>
            )}
            {/* Top bar */}
            <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3 flex-wrap">
                <h1 className="text-sm font-bold text-gray-900 shrink-0">
                {testType === 'SECTION' ? 'Section Test Builder' : 'Mock Test Builder'}
            </h1>
                <select value={selectedMockTestId} onChange={e => setSelectedMockTestId(e.target.value)}
                    className="text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 max-w-xs">
                    {mockTests.length === 0 && <option value="">No draft tests — create one →</option>}
                    {mockTests.map(m => <option key={m.mock_test_id} value={m.mock_test_id}>{m.name}</option>)}
                </select>

                {/* Section progress pills */}
                {sections.map(s => {
                    const cnt = sectionCounts[s.section_id] || 0;
                    const target = s.num_questions || '?';
                    const complete = cnt >= (s.num_questions || Infinity);
                    return (
                        <span key={s.section_id} className={`text-xs font-semibold px-2 py-1 rounded-full border ${
                            complete ? 'bg-green-100 text-green-700 border-green-200' : cnt > 0 ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-gray-100 text-gray-500 border-gray-200'
                        }`}>
                            {s.code}: {cnt}/{target}
                        </span>
                    );
                })}

                <div className="flex items-center gap-2 ml-auto">
                    <select value={newTestExamId} onChange={e => setNewTestExamId(e.target.value)}
                        className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none">
                        {exams.map(e => <option key={e.exam_id} value={e.exam_id}>{e.name}</option>)}
                    </select>
                    <input type="text" value={newTestName} onChange={e => setNewTestName(e.target.value)}
                        placeholder="New test name..."
                        className="text-xs border border-gray-200 rounded px-2 py-1.5 w-36 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                    <button onClick={handleCreateTest} disabled={creatingTest || !newTestName.trim()}
                        className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
                        {creatingTest ? '...' : '+ Create'}
                    </button>
                </div>
            </div>

            {/* Split panel */}
            {selectedMockTestId && mockTest ? (
                <div className="flex flex-1 overflow-hidden">
                    {/* Left */}
                    <div className="w-1/2 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
                        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Candidate</span>
                            <span className="text-xs text-gray-400">— from other exams</span>
                        </div>
                        <CandidatePanel
                            mockTestId={selectedMockTestId}
                            targetExamId={mockTest.exam_id}
                            onAccepted={handleAccepted}
                            acceptedIds={acceptedIds}
                        />
                    </div>

                    {/* Right */}
                    <div className="w-1/2 bg-white flex flex-col overflow-hidden">
                        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Accepted</span>
                            <span className="text-xs text-gray-400">— click a number to edit</span>
                        </div>
                        <AcceptedPanel
                            mockTestId={selectedMockTestId}
                            sections={sections}
                            accepted={accepted}
                            onRemoved={handleRemoved}
                            onUpdated={handleUpdated}
                        />
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                    Create or select a draft mock test to begin
                </div>
            )}
        </div>
    );
}
