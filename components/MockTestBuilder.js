'use client';

import { useState, useEffect, useCallback } from 'react';
import Latex from '@/components/Latex';

const DIFF_LABELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const DIFF_COLORS = {
    1: 'bg-green-100 text-green-700',
    2: 'bg-yellow-100 text-yellow-700',
    3: 'bg-red-100 text-red-700',
};

function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short' });
}

// ─── Candidate Card ───────────────────────────────────────────────────────────
function CandidatePanel({ mockTestId, section, examId, onAccepted, acceptedIds }) {
    const [subtype, setSubtype]             = useState('');
    const [subtypes, setSubtypes]           = useState([]);
    const [question, setQuestion]           = useState(null);
    const [poolRemaining, setPoolRemaining] = useState(null);
    const [loading, setLoading]             = useState(false);
    const [done, setDone]                   = useState(false);
    const [accepting, setAccepting]         = useState(false);
    // All IDs seen this session (skipped + accepted) so we never repeat
    const [seenIds, setSeenIds]             = useState([]);

    // Load subtypes for this section
    useEffect(() => {
        if (!section || !mockTestId || !examId) return;
        fetch(`/api/mock-test/builder/session?mock_test_id=${mockTestId}&section_id=${section.section_id}&exam_id=${examId}`)
            .then(r => r.json())
            .then(d => setSubtypes(d.subtypes || []))
            .catch(() => {});
    }, [section?.section_id, mockTestId, examId]);

    // Reset when section or subtype changes
    useEffect(() => {
        setQuestion(null);
        setDone(false);
        setSeenIds([]);
        setPoolRemaining(null);
    }, [section?.section_id, subtype]);

    const fetchNext = useCallback(async (extraExclude = []) => {
        if (!section || !mockTestId || !examId) return;
        setLoading(true);
        try {
            const allExclude = [...new Set([...seenIds, ...acceptedIds, ...extraExclude])];
            const res = await fetch('/api/mock-test/builder/candidate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mock_test_id: mockTestId,
                    section_id: section.section_id,
                    exam_id: examId,
                    subtype: subtype || undefined,
                    exclude_ids: allExclude,
                }),
            });
            const data = await res.json();
            if (data.done) {
                setDone(true);
                setQuestion(null);
            } else {
                setQuestion(data.question);
                setPoolRemaining(data.pool_remaining);
                setSeenIds(prev => [...new Set([...prev, data.question.question_id])]);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [section?.section_id, mockTestId, examId, subtype, seenIds, acceptedIds]);

    const handleAccept = async () => {
        if (!question) return;
        setAccepting(true);
        try {
            const res = await fetch('/api/mock-test/builder/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mock_test_id: mockTestId,
                    question_id: question.question_id,
                    section_id: section.section_id,
                }),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Failed to accept'); return; }
            onAccepted(question);
            fetchNext([question.question_id]);
        } finally {
            setAccepting(false);
        }
    };

    const handleSkip = () => {
        if (!question) return;
        fetchNext();
    };

    if (!section) {
        return (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                Select a section to start building
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Subtype filter */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
                <span className="text-xs font-medium text-gray-500">Subtype</span>
                <select
                    value={subtype}
                    onChange={e => setSubtype(e.target.value)}
                    className="text-sm border border-gray-200 rounded px-2 py-1 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                    <option value="">All subtypes</option>
                    {subtypes.map(s => (
                        <option key={s.subtype} value={s.subtype}>
                            {s.subtype} ({s.cnt})
                        </option>
                    ))}
                </select>
                {poolRemaining !== null && (
                    <span className="ml-auto text-xs text-gray-400">{poolRemaining} remaining in pool</span>
                )}
            </div>

            {/* Question area */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
                {!question && !loading && !done && (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                        <p className="text-gray-500 text-sm">Ready to load candidates for <strong>{section.code}</strong></p>
                        <button
                            onClick={() => fetchNext()}
                            className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
                        >
                            Load First Question
                        </button>
                    </div>
                )}

                {loading && (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm animate-pulse">
                        Loading...
                    </div>
                )}

                {done && !loading && (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                        No more candidates for this section{subtype ? ` / subtype "${subtype}"` : ''}.
                    </div>
                )}

                {question && !loading && (
                    <div className="space-y-4">
                        {/* Meta */}
                        <div className="flex flex-wrap items-center gap-2">
                            {question.subtype && (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
                                    {question.subtype}
                                </span>
                            )}
                            {question.difficulty && (
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${DIFF_COLORS[question.difficulty] || 'bg-gray-100 text-gray-600'}`}>
                                    {DIFF_LABELS[question.difficulty] || `D${question.difficulty}`}
                                </span>
                            )}
                            <span className="text-xs text-gray-400">
                                Q.{question.source_question_no || '?'} · {question.source_session} · {formatDate(question.source_date)}
                            </span>
                        </div>

                        {/* Question text */}
                        <div className="text-sm text-gray-900 leading-relaxed">
                            <Latex>{question.question_text || ''}</Latex>
                        </div>

                        {/* Options */}
                        <div className="space-y-1.5">
                            {(question.options || []).map(opt => (
                                <div
                                    key={opt.option_key}
                                    className={`flex items-start gap-2.5 px-3 py-2 rounded-lg text-sm border ${
                                        opt.option_key === question.correct_option_label
                                            ? 'border-green-300 bg-green-50 text-green-900'
                                            : 'border-gray-100 bg-white text-gray-700'
                                    }`}
                                >
                                    <span className="font-bold shrink-0 w-5 text-center">{opt.option_key}</span>
                                    <Latex>{opt.text || '—'}</Latex>
                                    {opt.option_key === question.correct_option_label && (
                                        <span className="ml-auto text-green-600 shrink-0">✓</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Action buttons */}
            {question && !loading && (
                <div className="px-4 py-3 border-t border-gray-100 flex gap-3">
                    <button
                        onClick={handleAccept}
                        disabled={accepting}
                        className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                        {accepting ? 'Adding...' : '✓ Accept'}
                    </button>
                    <button
                        onClick={handleSkip}
                        disabled={loading}
                        className="flex-1 py-2.5 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                    >
                        → Skip
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Accepted Panel ───────────────────────────────────────────────────────────
function AcceptedPanel({ mockTestId, section, examId, accepted, onRemoved }) {
    const [removing, setRemoving] = useState(null);

    const handleRemove = async (questionId) => {
        if (!confirm('Remove this question from the mock test?')) return;
        setRemoving(questionId);
        try {
            const res = await fetch('/api/mock-test/builder/accept', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mock_test_id: mockTestId, question_id: questionId }),
            });
            if (res.ok) onRemoved(questionId);
            else alert('Failed to remove');
        } finally {
            setRemoving(null);
        }
    };

    const sectionTarget = section?.num_questions || '?';

    return (
        <div className="flex flex-col h-full">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-700">{section?.name || 'Section'}</span>
                <span className={`ml-auto text-sm font-bold px-2.5 py-0.5 rounded-full ${
                    accepted.length >= sectionTarget
                        ? 'bg-green-100 text-green-700'
                        : accepted.length > 0
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-500'
                }`}>
                    {accepted.length} / {sectionTarget}
                </span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                {accepted.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                        No questions accepted yet
                    </div>
                ) : (
                    accepted.map((q, i) => (
                        <div key={q.question_id} className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50">
                            <span className="text-xs text-gray-400 font-mono pt-0.5 shrink-0 w-5">{i + 1}.</span>
                            <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap gap-1.5 mb-1">
                                    {q.subtype && (
                                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{q.subtype}</span>
                                    )}
                                    {q.difficulty && (
                                        <span className={`text-[11px] px-1.5 py-0.5 rounded ${DIFF_COLORS[q.difficulty] || 'bg-gray-100 text-gray-500'}`}>
                                            {DIFF_LABELS[q.difficulty] || `D${q.difficulty}`}
                                        </span>
                                    )}
                                    <span className="text-[11px] text-gray-400">{q.source_session}</span>
                                </div>
                                <p className="text-xs text-gray-700 line-clamp-2 leading-relaxed">
                                    {q.question_text?.replace(/!\[.*?\]\(.*?\)/g, '[img]').replace(/\$[^$]+\$/g, '[math]') || '—'}
                                </p>
                            </div>
                            <button
                                onClick={() => handleRemove(q.question_id)}
                                disabled={removing === q.question_id}
                                className="text-gray-300 hover:text-red-500 shrink-0 transition-colors disabled:opacity-50"
                                title="Remove"
                            >
                                ✕
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function MockTestBuilder({ mockTests, exams }) {
    const [selectedMockTestId, setSelectedMockTestId] = useState(mockTests[0]?.mock_test_id || '');
    const [activeSectionId, setActiveSectionId]       = useState(null);
    const [accepted, setAccepted]                     = useState([]); // for current section
    const [sections, setSections]                     = useState([]);
    const [sectionCounts, setSectionCounts]           = useState({}); // section_id → count
    const [loadingSection, setLoadingSection]         = useState(false);
    const [creatingTest, setCreatingTest]             = useState(false);
    const [newTestName, setNewTestName]               = useState('');
    const [newTestExamId, setNewTestExamId]           = useState(exams[0]?.exam_id || '');

    const mockTest = mockTests.find(m => m.mock_test_id === selectedMockTestId);
    const activeSection = sections.find(s => s.section_id === activeSectionId);
    const acceptedIds = accepted.map(q => q.question_id);

    // Load sections when mock test changes
    useEffect(() => {
        if (!selectedMockTestId) return;
        const mt = mockTests.find(m => m.mock_test_id === selectedMockTestId);
        if (!mt) return;
        fetch(`/api/mock-test/builder/sections?exam_id=${mt.exam_id}`)
            .then(r => r.json())
            .then(d => {
                setSections(d.sections || []);
                setActiveSectionId(d.sections?.[0]?.section_id || null);
                setSectionCounts(d.counts || {});
            })
            .catch(() => {});
    }, [selectedMockTestId]);

    // Load accepted questions when section changes
    useEffect(() => {
        if (!activeSectionId || !selectedMockTestId || !mockTest) return;
        setLoadingSection(true);
        fetch(`/api/mock-test/builder/session?mock_test_id=${selectedMockTestId}&section_id=${activeSectionId}&exam_id=${mockTest.exam_id}`)
            .then(r => r.json())
            .then(d => setAccepted(d.accepted || []))
            .catch(() => {})
            .finally(() => setLoadingSection(false));
    }, [activeSectionId, selectedMockTestId]);

    const handleAccepted = (q) => {
        setAccepted(prev => [...prev, q]);
        setSectionCounts(prev => ({ ...prev, [activeSectionId]: (prev[activeSectionId] || 0) + 1 }));
    };

    const handleRemoved = (questionId) => {
        setAccepted(prev => prev.filter(q => q.question_id !== questionId));
        setSectionCounts(prev => ({ ...prev, [activeSectionId]: Math.max(0, (prev[activeSectionId] || 1) - 1) }));
    };

    const handleCreateTest = async () => {
        if (!newTestName.trim() || !newTestExamId) return;
        setCreatingTest(true);
        try {
            const res = await fetch('/api/mock-test/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newTestName.trim(), exam_id: newTestExamId }),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Failed to create'); return; }
            window.location.reload();
        } finally {
            setCreatingTest(false);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            {/* Top bar */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-4 flex-wrap">
                <h1 className="text-base font-bold text-gray-900">Mock Test Builder</h1>

                {/* Mock test selector */}
                <select
                    value={selectedMockTestId}
                    onChange={e => setSelectedMockTestId(e.target.value)}
                    className="text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 max-w-xs"
                >
                    {mockTests.length === 0 && <option value="">No draft mock tests</option>}
                    {mockTests.map(m => (
                        <option key={m.mock_test_id} value={m.mock_test_id}>{m.name}</option>
                    ))}
                </select>

                {/* Create new mock test */}
                <div className="flex items-center gap-2 ml-auto">
                    <select
                        value={newTestExamId}
                        onChange={e => setNewTestExamId(e.target.value)}
                        className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none"
                    >
                        {exams.map(e => <option key={e.exam_id} value={e.exam_id}>{e.name}</option>)}
                    </select>
                    <input
                        type="text"
                        value={newTestName}
                        onChange={e => setNewTestName(e.target.value)}
                        placeholder="New test name..."
                        className="text-xs border border-gray-200 rounded px-2 py-1.5 w-40 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                    <button
                        onClick={handleCreateTest}
                        disabled={creatingTest || !newTestName.trim()}
                        className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {creatingTest ? 'Creating...' : '+ Create'}
                    </button>
                </div>
            </div>

            {/* Section tabs */}
            {sections.length > 0 && (
                <div className="bg-white border-b border-gray-200 px-4 flex gap-1 overflow-x-auto">
                    {sections.map(s => {
                        const count = activeSectionId === s.section_id ? accepted.length : (sectionCounts[s.section_id] || 0);
                        const target = s.num_questions || '?';
                        const complete = count >= (s.num_questions || Infinity);
                        return (
                            <button
                                key={s.section_id}
                                onClick={() => setActiveSectionId(s.section_id)}
                                className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                                    activeSectionId === s.section_id
                                        ? 'border-indigo-600 text-indigo-700'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                {s.code}
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                    complete ? 'bg-green-100 text-green-700' : count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                                }`}>
                                    {count}/{target}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Split panel */}
            {selectedMockTestId && mockTest ? (
                <div className="flex flex-1 overflow-hidden">
                    {/* Left: Candidate */}
                    <div className="w-1/2 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
                        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Candidate</span>
                        </div>
                        {loadingSection ? (
                            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm animate-pulse">Loading section...</div>
                        ) : (
                            <CandidatePanel
                                mockTestId={selectedMockTestId}
                                section={activeSection}
                                examId={mockTest.exam_id}
                                onAccepted={handleAccepted}
                                acceptedIds={acceptedIds}
                            />
                        )}
                    </div>

                    {/* Right: Accepted */}
                    <div className="w-1/2 bg-white flex flex-col overflow-hidden">
                        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Accepted</span>
                        </div>
                        <AcceptedPanel
                            mockTestId={selectedMockTestId}
                            section={activeSection}
                            examId={mockTest.exam_id}
                            accepted={accepted}
                            onRemoved={handleRemoved}
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
