'use client';

import { useState, useEffect } from 'react';
import Latex from '@/components/Latex';

export default function SolutionReview() {
    const [papers, setPapers] = useState([]);
    const [loadingPapers, setLoadingPapers] = useState(true);
    const [selectedPaper, setSelectedPaper] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [isMarking, setIsMarking] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [flaggingId, setFlaggingId] = useState(null);
    const [flagNotes, setFlagNotes] = useState({});
    const [edits, setEdits] = useState({});
    const [savingId, setSavingId] = useState(null);

    useEffect(() => {
        fetchPapers();
    }, []);

    const fetchPapers = async () => {
        setLoadingPapers(true);
        try {
            const res = await fetch('/api/solution-review/papers');
            const data = await res.json();
            if (res.ok && data.papers) {
                setPapers(data.papers);
            }
        } catch (err) {
            console.error('Failed to fetch papers:', err);
        } finally {
            setLoadingPapers(false);
        }
    };

    const handlePaperClick = async (paper) => {
        setSelectedPaper(paper);
        setQuestions([]);
        setFeedback(null);
        setFlaggingId(null);
        setFlagNotes({});
        setEdits({});
        setLoadingQuestions(true);

        try {
            const res = await fetch(`/api/solution-review/questions?paperId=${paper.paper_session_id}`);
            const data = await res.json();
            if (res.ok && data.questions) {
                setQuestions(data.questions);
                const notes = {};
                for (const q of data.questions) {
                    if (q.flag_note) notes[q.question_id] = q.flag_note;
                }
                setFlagNotes(notes);
            } else {
                setFeedback({ type: 'error', message: data.error || 'Failed to load questions.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error loading questions.' });
        } finally {
            setLoadingQuestions(false);
        }
    };

    const handleFlag = async (question, shouldFlag) => {
        setFlaggingId(question.question_id);
        try {
            const res = await fetch('/api/solution-review/flag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: question.question_id,
                    version_no: question.version_no,
                    flag: shouldFlag,
                    note: flagNotes[question.question_id] || '',
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setQuestions(prev => prev.map(q =>
                    q.question_id === question.question_id
                        ? { ...q, status: shouldFlag ? 'FLAGGED' : 'DRAFT', flag_note: shouldFlag ? (flagNotes[q.question_id] || '') : null }
                        : q
                ));
                // When flagging, initialize edit state from current values
                if (shouldFlag) {
                    setEdits(prev => ({
                        ...prev,
                        [question.question_id]: {
                            answer_label: question.answer_label || '',
                            solution_text: question.solution_text || '',
                            difficulty: question.difficulty || '',
                            tags: question.tags || '',
                        }
                    }));
                } else {
                    // Clear edit state on unflag
                    setEdits(prev => {
                        const next = { ...prev };
                        delete next[question.question_id];
                        return next;
                    });
                }
            } else {
                setFeedback({ type: 'error', message: data.error || 'Flag operation failed.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error during flag.' });
        } finally {
            setFlaggingId(null);
        }
    };

    const updateEdit = (questionId, field, value) => {
        setEdits(prev => ({
            ...prev,
            [questionId]: {
                ...prev[questionId],
                [field]: value,
            },
        }));
    };

    const handleSaveAndUnflag = async (question) => {
        const edit = edits[question.question_id];
        if (!edit) return;
        setSavingId(question.question_id);
        setFeedback(null);

        try {
            // Save the updated solution
            const saveRes = await fetch('/api/solution-review/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paper_session_id: selectedPaper.paper_session_id,
                    solutions: [{
                        question_id: question.question_id,
                        version_no: question.version_no,
                        answer_label: edit.answer_label,
                        solution_text: edit.solution_text,
                        difficulty: edit.difficulty,
                        tags: edit.tags,
                    }],
                }),
            });
            const saveData = await saveRes.json();
            if (!saveRes.ok || !saveData.success) {
                setFeedback({ type: 'error', message: saveData.error || 'Save failed.' });
                return;
            }

            // Unflag the question
            const flagRes = await fetch('/api/solution-review/flag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: question.question_id,
                    version_no: question.version_no,
                    flag: false,
                }),
            });
            const flagData = await flagRes.json();
            if (flagRes.ok && flagData.success) {
                setQuestions(prev => prev.map(q =>
                    q.question_id === question.question_id
                        ? {
                            ...q,
                            status: 'DRAFT',
                            flag_note: null,
                            answer_label: edit.answer_label,
                            solution_text: edit.solution_text,
                            difficulty: edit.difficulty,
                            tags: edit.tags,
                        }
                        : q
                ));
                setEdits(prev => {
                    const next = { ...prev };
                    delete next[question.question_id];
                    return next;
                });
                setFeedback({ type: 'success', message: `Q.${question.source_q_no || '?'} saved and unflagged.` });
            } else {
                setFeedback({ type: 'error', message: flagData.error || 'Unflag failed after save.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error.' });
        } finally {
            setSavingId(null);
        }
    };

    const handleMarkReviewed = async () => {
        if (!selectedPaper) return;
        const flagged = questions.filter(q => q.status === 'FLAGGED').length;
        if (flagged > 0) {
            const ok = confirm(`${flagged} question(s) are still flagged. Mark as reviewed anyway?`);
            if (!ok) return;
        }
        setIsMarking(true);
        setFeedback(null);

        try {
            const res = await fetch('/api/solution-review/mark-reviewed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paper_session_id: selectedPaper.paper_session_id }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', message: 'Paper marked as Solution Reviewed.' });
                setPapers(prev => prev.filter(p => p.paper_session_id !== selectedPaper.paper_session_id));
                setSelectedPaper(null);
                setQuestions([]);
            } else {
                setFeedback({ type: 'error', message: data.error || 'Failed to mark as reviewed.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error.' });
        } finally {
            setIsMarking(false);
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const flaggedCount = questions.filter(q => q.status === 'FLAGGED').length;

    return (
        <div className="flex h-screen overflow-hidden bg-white">
            {/* Left Sidebar */}
            <aside className="w-72 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
                <div className="px-4 py-4 border-b border-gray-200">
                    <h1 className="text-lg font-bold text-gray-900">Solution Review</h1>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {loadingPapers ? 'Loading...' : `${papers.length} papers ready for review`}
                    </p>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {loadingPapers ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full"></div>
                        </div>
                    ) : papers.length === 0 ? (
                        <div className="p-4 text-sm text-gray-400 italic text-center mt-8">
                            No papers with complete solutions found.
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {papers.map(paper => {
                                const isSelected = selectedPaper?.paper_session_id === paper.paper_session_id;
                                return (
                                    <li key={paper.paper_session_id}>
                                        <button
                                            onClick={() => handlePaperClick(paper)}
                                            className={`w-full text-left px-4 py-3 transition-colors hover:bg-blue-50 ${isSelected ? 'bg-blue-100 border-l-4 border-blue-500' : 'border-l-4 border-transparent'}`}
                                        >
                                            <div className="text-sm font-semibold text-gray-900 truncate">{paper.session_label}</div>
                                            {paper.exam_name && (
                                                <div className="text-xs text-indigo-600 mt-0.5 truncate">{paper.exam_name}</div>
                                            )}
                                            <div className="text-xs text-gray-500 mt-0.5">{paper.subject || 'No subject'}</div>
                                            <div className="flex items-center justify-between mt-1">
                                                <span className="text-xs text-gray-400">{formatDate(paper.paper_date)}</span>
                                                <span className="text-xs font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                                                    {parseInt(paper.solution_count || 0)}/{parseInt(paper.question_count || 0)} solved
                                                </span>
                                            </div>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </aside>

            {/* Right Main Area */}
            <main className="flex-1 overflow-y-auto bg-gray-50">
                {!selectedPaper ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <div className="text-5xl mb-4">📋</div>
                            <h2 className="text-xl font-semibold text-gray-700">Select a paper to review</h2>
                            <p className="text-gray-400 mt-2 text-sm">Papers with all solutions filled are shown on the left.</p>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col h-full">
                        {/* Sticky top bar */}
                        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm px-6 py-3 flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <h2 className="text-base font-bold text-gray-900 truncate">{selectedPaper.session_label}</h2>
                                <p className="text-xs text-gray-500">
                                    {selectedPaper.exam_name} &middot; {selectedPaper.subject} &middot; {formatDate(selectedPaper.paper_date)} &middot; {questions.length} questions
                                </p>
                            </div>
                            {feedback && (
                                <div className={`text-sm px-3 py-1.5 rounded font-medium ${feedback.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                                    {feedback.message}
                                </div>
                            )}
                            <div className="flex items-center gap-3">
                                {flaggedCount > 0 && (
                                    <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded">
                                        {flaggedCount} flagged
                                    </span>
                                )}
                                <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-1 rounded">
                                    Status: {selectedPaper.status}
                                </span>
                            </div>
                        </div>

                        {/* Questions list */}
                        <div className="flex-1 overflow-y-auto">
                            <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
                                {loadingQuestions ? (
                                    <div className="flex items-center justify-center py-24">
                                        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
                                        <span className="ml-3 text-gray-500">Loading questions...</span>
                                    </div>
                                ) : questions.length === 0 ? (
                                    <div className="text-center py-24 text-gray-400">No questions found for this paper.</div>
                                ) : (
                                    questions.map((q, idx) => {
                                        const isFlagged = q.status === 'FLAGGED';
                                        const edit = edits[q.question_id];
                                        const displayAnswer = edit ? edit.answer_label : q.answer_label;
                                        return (
                                            <div key={q.question_id} className={`bg-white rounded-lg border shadow-sm overflow-hidden ${isFlagged ? 'border-red-300 ring-1 ring-red-200' : 'border-gray-200'}`}>
                                                {/* Question Header */}
                                                <div className={`px-5 py-3 border-b flex items-center justify-between ${isFlagged ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-bold text-gray-700">
                                                            Q.{q.source_q_no || idx + 1}
                                                        </span>
                                                        {isFlagged && (
                                                            <span className="text-xs font-bold bg-red-500 text-white px-1.5 py-0.5 rounded">FLAGGED</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        {(edit ? edit.difficulty : q.difficulty) && (
                                                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                                                                (edit ? edit.difficulty : q.difficulty) === 'easy' ? 'bg-green-100 text-green-700' :
                                                                (edit ? edit.difficulty : q.difficulty) === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                                                'bg-red-100 text-red-700'
                                                            }`}>
                                                                {edit ? edit.difficulty : q.difficulty}
                                                            </span>
                                                        )}
                                                        {displayAnswer && (
                                                            <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                                                Ans: {displayAnswer}
                                                            </span>
                                                        )}
                                                        {isFlagged && (
                                                            <button
                                                                onClick={() => handleFlag(q, false)}
                                                                disabled={flaggingId === q.question_id}
                                                                className="text-xs font-semibold px-2 py-1 rounded transition-colors bg-gray-200 text-gray-700 hover:bg-gray-300"
                                                            >
                                                                {flaggingId === q.question_id ? '...' : 'Unflag'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Question Text */}
                                                <div className="px-5 py-4 border-b border-gray-100">
                                                    <div className="text-sm text-gray-800">
                                                        <Latex>{q.question_text || '(No question text)'}</Latex>
                                                    </div>
                                                </div>

                                                {/* Options */}
                                                <div className="px-5 py-4 border-b border-gray-100 grid grid-cols-2 gap-3">
                                                    {(q.options || []).map(opt => {
                                                        const isCorrect = displayAnswer === opt.opt_label;
                                                        return (
                                                            <div
                                                                key={opt.opt_label}
                                                                className={`flex gap-2 items-start p-3 rounded-md border ${isCorrect ? 'bg-green-50 border-green-400' : 'bg-white border-gray-200'}`}
                                                            >
                                                                <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${isCorrect ? 'bg-green-500 text-white border-green-500' : 'bg-gray-100 text-gray-600 border-gray-300'}`}>
                                                                    {opt.opt_label}
                                                                </span>
                                                                <div className="text-sm text-gray-700 pt-0.5 flex-1">
                                                                    <Latex>{opt.opt_text || ''}</Latex>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Solution — read-only when not flagged, editable when flagged */}
                                                {isFlagged && edit ? (
                                                    <div className="px-5 py-4 bg-red-50 border-b border-red-200 space-y-4">
                                                        <div className="text-xs font-bold text-red-700 uppercase tracking-wide">Edit Solution</div>

                                                        {/* Issue note */}
                                                        {q.flag_note && (
                                                            <div className="text-sm text-red-700 bg-red-100 px-3 py-2 rounded">
                                                                Issue: {q.flag_note}
                                                            </div>
                                                        )}

                                                        {/* Answer + Difficulty row */}
                                                        <div className="flex flex-wrap gap-4 items-end">
                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Answer</label>
                                                                <select
                                                                    value={edit.answer_label}
                                                                    onChange={e => updateEdit(q.question_id, 'answer_label', e.target.value)}
                                                                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                                                >
                                                                    <option value="">Select</option>
                                                                    <option value="A">A</option>
                                                                    <option value="B">B</option>
                                                                    <option value="C">C</option>
                                                                    <option value="D">D</option>
                                                                </select>
                                                            </div>
                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Difficulty</label>
                                                                <select
                                                                    value={edit.difficulty}
                                                                    onChange={e => updateEdit(q.question_id, 'difficulty', e.target.value)}
                                                                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                                                >
                                                                    <option value="">Select</option>
                                                                    <option value="easy">Easy</option>
                                                                    <option value="medium">Medium</option>
                                                                    <option value="hard">Hard</option>
                                                                </select>
                                                            </div>
                                                            <div className="flex flex-col gap-1 flex-1 min-w-48">
                                                                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Tags</label>
                                                                <input
                                                                    type="text"
                                                                    value={edit.tags}
                                                                    onChange={e => updateEdit(q.question_id, 'tags', e.target.value)}
                                                                    placeholder="e.g. algebra, quadratic"
                                                                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                                />
                                                            </div>
                                                        </div>

                                                        {/* Solution text */}
                                                        <div>
                                                            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1.5">Solution</label>
                                                            <textarea
                                                                rows={4}
                                                                value={edit.solution_text}
                                                                onChange={e => updateEdit(q.question_id, 'solution_text', e.target.value)}
                                                                placeholder="Step-by-step solution..."
                                                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                                                            />
                                                        </div>

                                                        {/* Save & Unflag button */}
                                                        <div className="flex justify-end">
                                                            <button
                                                                onClick={() => handleSaveAndUnflag(q)}
                                                                disabled={savingId === q.question_id}
                                                                className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                                                            >
                                                                {savingId === q.question_id ? (
                                                                    <>
                                                                        <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                                                                        Saving...
                                                                    </>
                                                                ) : (
                                                                    'Save & Unflag'
                                                                )}
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {/* Read-only solution */}
                                                        {q.solution_text && (
                                                            <div className="px-5 py-4 bg-amber-50">
                                                                <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1.5">Solution</div>
                                                                <div className="text-sm text-gray-800 whitespace-pre-wrap">
                                                                    <Latex>{q.solution_text}</Latex>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Tags */}
                                                        {q.tags && (
                                                            <div className="px-5 py-2 border-t border-gray-100 bg-gray-50">
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {q.tags.split(',').map((tag, i) => (
                                                                        <span key={i} className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">
                                                                            {tag.trim()}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </>
                                                )}

                                                {/* Flag action bar (if not flagged) */}
                                                {!isFlagged && (
                                                    <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2">
                                                        <input
                                                            type="text"
                                                            value={flagNotes[q.question_id] || ''}
                                                            onChange={e => setFlagNotes(prev => ({ ...prev, [q.question_id]: e.target.value }))}
                                                            placeholder="Issue note (optional)..."
                                                            className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-red-400 focus:border-red-400"
                                                        />
                                                        <button
                                                            onClick={() => handleFlag(q, true)}
                                                            disabled={flaggingId === q.question_id}
                                                            className="px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded-md hover:bg-red-600 disabled:opacity-50 transition-colors"
                                                        >
                                                            {flaggingId === q.question_id ? '...' : 'Flag Issue'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Bottom bar */}
                        {questions.length > 0 && !loadingQuestions && (
                            <div className="sticky bottom-0 bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] px-6 py-4 flex items-center justify-between">
                                <div className="text-sm text-gray-500">
                                    {questions.length} questions
                                    {flaggedCount > 0 && (
                                        <span className="text-red-600 font-semibold ml-2">({flaggedCount} flagged)</span>
                                    )}
                                </div>
                                <button
                                    onClick={handleMarkReviewed}
                                    disabled={isMarking}
                                    className="px-6 py-2.5 bg-green-600 text-white text-sm font-bold rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                                >
                                    {isMarking ? (
                                        <>
                                            <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                                            Marking...
                                        </>
                                    ) : (
                                        'Solution Reviewed'
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
