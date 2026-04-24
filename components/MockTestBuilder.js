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

// ─── Subtype sidebar ─────────────────────────────────────────────────────────
function SubtypeSidebar({ subtypes, acceptedSubtypes, activeSubtype, onSelect, loading }) {
    const acceptedMap = {};
    for (const s of acceptedSubtypes) acceptedMap[s.subtype] = parseInt(s.cnt);
    const totalPool = subtypes.reduce((s, t) => s + parseInt(t.cnt), 0);
    const totalAccepted = acceptedSubtypes.reduce((s, t) => s + parseInt(t.cnt), 0);

    return (
        <div className="flex flex-col h-full border-r border-gray-200 bg-gray-50/80 w-56 shrink-0">
            <div className="px-3 py-2.5 border-b border-gray-100">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Subtypes</div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                    Pool: {totalPool} | Accepted: {totalAccepted}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto">
                {/* All subtypes button */}
                <button
                    onClick={() => onSelect('')}
                    disabled={loading}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors border-b border-gray-100
                        ${activeSubtype === '' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                    <span className="flex-1 truncate">All subtypes</span>
                    <span className="text-[10px] text-gray-400">{totalPool}</span>
                </button>
                {subtypes.map(s => {
                    const acc = acceptedMap[s.subtype] || 0;
                    const isActive = activeSubtype === s.subtype;
                    return (
                        <button
                            key={s.subtype}
                            onClick={() => onSelect(s.subtype)}
                            disabled={loading}
                            className={`w-full text-left px-3 py-2 text-xs flex items-center gap-1.5 transition-colors border-b border-gray-50
                                ${isActive ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                            <span className="flex-1 truncate">{s.subtype}</span>
                            {acc > 0 && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">{acc}</span>
                            )}
                            <span className="text-[10px] text-gray-400">{s.cnt}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Left: Candidate panel ────────────────────────────────────────────────────
function CandidatePanel({ mockTestId, targetExamId, onAccepted, acceptedIds, onSubtypesLoaded,
                          sections, sectionId, onSectionChange, sectionCounts }) {
    const [subtype, setSubtype]             = useState('');
    const [subtypes, setSubtypes]           = useState([]);
    const [acceptedSubtypes, setAcceptedSubtypes] = useState([]);
    const [candidates, setCandidates]       = useState([]); // all loaded candidates
    const [dismissed, setDismissed]         = useState(new Set()); // dismissed question_ids
    const [loading, setLoading]             = useState(false);
    const [accepting, setAccepting]         = useState(null); // question_id currently accepting
    const [blueprints, setBlueprints]       = useState([]);

    const currentSection = sections.find(s => s.section_id === sectionId);
    const sectionCode = currentSection?.code || '';

    // Load blueprints for the target exam
    useEffect(() => {
        if (!targetExamId) return;
        fetch(`/api/mock-test/blueprint/list?exam_id=${targetExamId}`)
            .then(r => r.json())
            .then(d => setBlueprints(d.blueprints || []))
            .catch(() => {});
    }, [targetExamId]);

    // Load cross-exam subtypes + accepted subtypes, filtered by section code
    const refreshSubtypes = useCallback(() => {
        if (!targetExamId) return;
        const scParam = sectionCode ? `&section_code=${encodeURIComponent(sectionCode)}` : '';
        fetch(`/api/mock-test/builder/session?mock_test_id=${mockTestId}&section_id=_&exam_id=${targetExamId}${scParam}`)
            .then(r => r.json())
            .then(d => {
                setSubtypes(d.subtypes || []);
                setAcceptedSubtypes(d.accepted_subtypes || []);
                if (onSubtypesLoaded) onSubtypesLoaded(d.accepted_subtypes || []);
            })
            .catch(() => {});
    }, [targetExamId, mockTestId, sectionCode, onSubtypesLoaded]);

    useEffect(() => { refreshSubtypes(); }, [refreshSubtypes]);

    // Reset candidates when subtype or section changes
    useEffect(() => {
        setCandidates([]);
        setDismissed(new Set());
    }, [subtype, sectionId]);

    // Reset subtype selection when section changes (subtypes differ per section)
    useEffect(() => {
        setSubtype('');
    }, [sectionId]);

    const handleSubtypeSelect = (st) => { setSubtype(st); };

    // Fetch a batch of candidates
    const fetchBatch = useCallback(async (append = false) => {
        if (!targetExamId) return;
        setLoading(true);
        try {
            const existingIds = append ? candidates.map(q => q.question_id) : [];
            const allExclude = [...new Set([...existingIds, ...acceptedIds])];
            const res = await fetch('/api/mock-test/builder/bulk-candidates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mock_test_id: mockTestId,
                    target_exam_id: targetExamId,
                    slots: [{ subtype: subtype || undefined, count: 30 }],
                    section_code: sectionCode || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Load failed'); return; }
            const newQ = (data.results || []).flatMap(r => r.questions)
                .filter(q => !allExclude.includes(q.question_id));
            if (append) setCandidates(prev => [...prev, ...newQ]);
            else { setCandidates(newQ); setDismissed(new Set()); }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [targetExamId, mockTestId, subtype, sectionCode, candidates, acceptedIds]);

    // Load from blueprint
    const handleLoadBlueprint = async (blueprintId, targetSectionId) => {
        const bp = blueprints.find(b => b.blueprint_id === blueprintId);
        if (!bp) return;
        const section = (bp.config_json?.sections || []).find(s => s.section_id === targetSectionId);
        if (!section?.topic_slots?.length) { alert('No slots defined for this section in the blueprint'); return; }
        setLoading(true);
        try {
            const res = await fetch('/api/mock-test/builder/bulk-candidates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mock_test_id: mockTestId,
                    target_exam_id: targetExamId,
                    slots: section.topic_slots.map(t => ({ subtype: t.subtype, count: t.count, difficulty: t.difficulty || undefined })),
                    section_code: sectionCode || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Load failed'); return; }
            const allQ = data.results.flatMap(r => r.questions.map(q => ({ ...q, _targetSection: targetSectionId })));
            setCandidates(allQ);
            setDismissed(new Set());
            onSectionChange(targetSectionId);
        } finally { setLoading(false); }
    };

    const handleAccept = async (question) => {
        if (!sectionId) { alert('Select a section first'); return; }
        // Enforce section limit
        const sec = sections.find(s => s.section_id === sectionId);
        const currentCount = sectionCounts[sectionId] || 0;
        if (sec?.num_questions && currentCount >= sec.num_questions) {
            alert(`Section ${sec.code} is full (${currentCount}/${sec.num_questions}). Remove a question first or switch to another section.`);
            return;
        }
        setAccepting(question.question_id);
        try {
            const res = await fetch('/api/mock-test/builder/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mock_test_id: mockTestId, source_question_id: question.question_id, section_id: sectionId }),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Failed to accept'); return; }
            onAccepted({ ...question, question_id: data.new_question_id, section_id: sectionId, exam_section_id: sectionId });
            setCandidates(prev => prev.filter(q => q.question_id !== question.question_id));
            refreshSubtypes();
        } finally { setAccepting(null); }
    };

    const handleDismiss = (questionId) => {
        setDismissed(prev => new Set([...prev, questionId]));
    };

    const visible = candidates.filter(q => !dismissed.has(q.question_id));

    return (
        <div className="flex h-full flex-1 min-w-0">
            {/* Subtype sidebar */}
            <SubtypeSidebar
                subtypes={subtypes}
                acceptedSubtypes={acceptedSubtypes}
                activeSubtype={subtype}
                onSelect={handleSubtypeSelect}
                loading={loading}
            />

            {/* Question list */}
            <div className="flex flex-col flex-1 min-w-0">
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Section</span>
                        <select value={sectionId} onChange={e => onSectionChange(e.target.value)}
                            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400">
                            {sections.map(s => <option key={s.section_id} value={s.section_id}>{s.code}</option>)}
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
                        </div>
                    )}
                    {visible.length > 0 && (
                        <span className="text-xs text-gray-500">{visible.length} shown</span>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                        {candidates.length > 0 && (
                            <button onClick={() => fetchBatch(true)} disabled={loading}
                                className="text-xs px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50">
                                {loading ? '...' : 'Load More'}
                            </button>
                        )}
                        <button onClick={() => fetchBatch(false)} disabled={loading}
                            className="text-xs px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
                            {loading ? 'Loading...' : candidates.length === 0 ? 'Load Candidates' : 'Reload'}
                        </button>
                    </div>
                </div>

                {/* Scrollable candidate list */}
                <div className="flex-1 overflow-y-auto">
                    {loading && candidates.length === 0 && (
                        <div className="flex items-center justify-center h-full text-gray-400 text-sm animate-pulse">Loading candidates...</div>
                    )}
                    {!loading && candidates.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full gap-3">
                            <p className="text-sm text-gray-400">
                                {subtype ? `Select "${subtype}" and click Load` : 'Pick a subtype or click Load Candidates'}
                            </p>
                        </div>
                    )}
                    {visible.length === 0 && candidates.length > 0 && !loading && (
                        <div className="flex flex-col items-center justify-center h-full gap-3">
                            <p className="text-sm text-gray-400">All candidates handled</p>
                            <button onClick={() => fetchBatch(false)}
                                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200">
                                Load More
                            </button>
                        </div>
                    )}

                    {visible.map((q, i) => (
                        <div key={q.question_id} className="border-b border-gray-100 px-4 py-3 hover:bg-gray-50/50">
                            {/* Header row with meta + action buttons */}
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-bold text-gray-400 w-5 shrink-0">{i + 1}</span>
                                {q.entry_source === 'manual' ? (
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                                        Manual
                                    </span>
                                ) : q.source_exam && (
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100">
                                        {q.source_exam_code || q.source_exam}
                                    </span>
                                )}
                                {q.subtype && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">{q.subtype}</span>
                                )}
                                <span className="text-[10px] text-gray-400">
                                    {q.entry_source === 'manual' ? 'Manual Entry' : `Q.${q.source_question_no || '?'} · ${q.source_session || ''}`}
                                </span>
                                {/* Action buttons — right aligned */}
                                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                                    <button
                                        onClick={() => handleAccept(q)}
                                        disabled={accepting === q.question_id}
                                        className="px-3 py-1 bg-green-600 text-white rounded text-xs font-semibold hover:bg-green-700 disabled:opacity-50">
                                        {accepting === q.question_id ? '...' : 'Accept'}
                                    </button>
                                    <button
                                        onClick={() => handleDismiss(q.question_id)}
                                        className="px-3 py-1 bg-white text-gray-500 border border-gray-200 rounded text-xs hover:bg-red-50 hover:text-red-600 hover:border-red-200">
                                        Reject
                                    </button>
                                </div>
                            </div>

                            {/* Question text */}
                            <div className="text-sm text-gray-900 leading-relaxed mb-2 pl-7">
                                <Latex>{q.question_text || ''}</Latex>
                            </div>

                            {/* Options — compact inline */}
                            <div className="grid grid-cols-2 gap-1.5 pl-7">
                                {(q.options || []).map(opt => (
                                    <div key={opt.option_key}
                                        className={`flex items-start gap-1.5 px-2 py-1 rounded text-xs border ${
                                            opt.option_key === q.correct_option_label
                                                ? 'border-green-300 bg-green-50 text-green-800'
                                                : 'border-gray-100 bg-white text-gray-600'
                                        }`}>
                                        <span className="font-bold shrink-0">{opt.option_key}.</span>
                                        <Latex>{opt.text || '—'}</Latex>
                                    </div>
                                ))}
                            </div>

                            {/* Solution — collapsed */}
                            {q.solution_json?.solution_text && (
                                <div className="mt-1.5 pl-7 text-[10px] text-amber-700 line-clamp-1">
                                    Sol: {q.solution_json.solution_text}
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Load more at bottom */}
                    {visible.length > 0 && (
                        <div className="px-4 py-4 flex justify-center">
                            <button onClick={() => fetchBatch(true)} disabled={loading}
                                className="px-5 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50">
                                {loading ? 'Loading...' : 'Load More'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Right: Accepted — scrollable list with inline edit ───────────────────────
function AcceptedPanel({ mockTestId, sections, accepted, onRemoved, onUpdated, acceptedSubtypes }) {
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

            if (data.new_question_id) {
                // Stem changed — swap the old question_id for the new one everywhere
                setEditStates(prev => {
                    const next = { ...prev };
                    next[data.new_question_id] = next[questionId];
                    delete next[questionId];
                    return next;
                });
                setExpandedId(data.new_question_id);
                onUpdated(questionId, es, data.new_question_id);
            } else {
                onUpdated(questionId, es);
            }
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

    // Compute accepted subtype breakdown from actual accepted list (live)
    const liveSubtypeCounts = {};
    for (const q of accepted) {
        const st = q.subtype || 'Unknown';
        liveSubtypeCounts[st] = (liveSubtypeCounts[st] || 0) + 1;
    }
    const sortedLiveSubtypes = Object.entries(liveSubtypeCounts).sort((a, b) => b[1] - a[1]);

    if (accepted.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                Accept a question to see it here
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto">
            {/* Subtype coverage */}
            {sortedLiveSubtypes.length > 0 && (
                <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
                    <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                        Coverage ({accepted.length} questions)
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {sortedLiveSubtypes.map(([st, cnt]) => (
                            <span key={st} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 font-medium">
                                {st}: {cnt}
                            </span>
                        ))}
                    </div>
                </div>
            )}
            <div className="divide-y divide-gray-100">
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
        </div>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function MockTestBuilder({ mockTests, exams, testType = 'MOCK', migrationPending = false }) {
    const [selectedMockTestId, setSelectedMockTestId] = useState(mockTests[0]?.mock_test_id || '');
    const [accepted, setAccepted]     = useState([]);
    const [sections, setSections]     = useState([]);
    const [sectionId, setSectionId]   = useState('');
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
            .then(d => {
                setSections(d.sections || []);
                setSectionCounts(d.counts || {});
                setSectionId(prev => prev || d.sections?.[0]?.section_id || '');
            })
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

    const handleUpdated = (questionId, edits, newQuestionId = null) => {
        setAccepted(prev => prev.map(q => {
            if (q.question_id !== questionId) return q;
            const updated = { ...q, ...edits, solution_json: { ...(q.solution_json || {}), solution_text: edits.solution_text } };
            if (newQuestionId) updated.question_id = newQuestionId;
            return updated;
        }));
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

            {/* Split panel: Subtype sidebar + Candidate | Accepted */}
            {selectedMockTestId && mockTest ? (
                <div className="flex flex-1 overflow-hidden">
                    {/* Left: Subtype sidebar + Candidate viewer */}
                    <div className="flex-1 border-r border-gray-200 bg-white flex flex-col overflow-hidden" style={{ minWidth: 0 }}>
                        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Candidate</span>
                            <span className="text-xs text-gray-400">— pick subtype, then accept</span>
                        </div>
                        <CandidatePanel
                            mockTestId={selectedMockTestId}
                            targetExamId={mockTest.exam_id}
                            onAccepted={handleAccepted}
                            acceptedIds={acceptedIds}
                            sections={sections}
                            sectionId={sectionId}
                            onSectionChange={setSectionId}
                            sectionCounts={sectionCounts}
                        />
                    </div>

                    {/* Right: Accepted */}
                    <div className="bg-white flex flex-col overflow-hidden" style={{ width: '38%', minWidth: 340 }}>
                        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Accepted</span>
                                {sectionId && sections.find(s => s.section_id === sectionId) && (
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">
                                        {sections.find(s => s.section_id === sectionId).code}
                                    </span>
                                )}
                                <span className="text-xs text-gray-400">— click to edit</span>
                            </div>
                            {/* Section progress pills */}
                            <div className="flex flex-wrap gap-1.5">
                                {sections.map(s => {
                                    const cnt = sectionCounts[s.section_id] || 0;
                                    const target = s.num_questions || '?';
                                    const isCurrent = s.section_id === sectionId;
                                    const complete = s.num_questions && cnt >= s.num_questions;
                                    const over = s.num_questions && cnt > s.num_questions;
                                    return (
                                        <button key={s.section_id}
                                            onClick={() => setSectionId(s.section_id)}
                                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                                                over ? 'bg-red-100 text-red-700 border-red-300'
                                                : complete ? 'bg-green-100 text-green-700 border-green-200'
                                                : cnt > 0 ? 'bg-amber-100 text-amber-700 border-amber-200'
                                                : 'bg-gray-100 text-gray-500 border-gray-200'
                                            } ${isCurrent ? 'ring-2 ring-indigo-400 ring-offset-1' : 'hover:opacity-80'}`}>
                                            {s.code}: {cnt}/{target}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <AcceptedPanel
                            mockTestId={selectedMockTestId}
                            sections={sections}
                            accepted={accepted.filter(q => !sectionId || (q.exam_section_id || q.section_id) === sectionId)}
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
