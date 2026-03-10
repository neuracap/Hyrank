'use client';

import { useState } from 'react';
import Latex from '@/components/Latex';

export default function SolutionReview({ papers }) {
    const [selectedPaper, setSelectedPaper] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [solutions, setSolutions] = useState({});
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [isSolving, setIsSolving] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const handlePaperClick = async (paper) => {
        setSelectedPaper(paper);
        setQuestions([]);
        setSolutions({});
        setFeedback(null);
        setLoadingQuestions(true);

        try {
            const res = await fetch(`/api/solution-review/questions?paperId=${paper.paper_session_id}`);
            const data = await res.json();
            if (res.ok && data.questions) {
                setQuestions(data.questions);
                // Pre-populate solutions from existing data
                const initial = {};
                for (const q of data.questions) {
                    initial[q.question_id] = {
                        answer_label: q.answer_label || '',
                        solution_text: q.solution_text || '',
                        difficulty: q.difficulty || '',
                        tags: q.tags || '',
                    };
                }
                setSolutions(initial);
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

    const updateSolution = (questionId, field, value) => {
        setSolutions(prev => ({
            ...prev,
            [questionId]: {
                ...prev[questionId],
                [field]: value,
            },
        }));
    };

    const handleSolveWithAI = async () => {
        if (!selectedPaper) return;
        setIsSolving(true);
        setFeedback(null);
        try {
            const res = await fetch('/api/solution-review/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paper_session_id: selectedPaper.paper_session_id }),
            });
            const data = await res.json();
            if (res.ok && data.solutions) {
                setSolutions(prev => {
                    const next = { ...prev };
                    for (const s of data.solutions) {
                        next[s.question_id] = {
                            ...next[s.question_id],
                            answer_label: s.answer_label || next[s.question_id]?.answer_label || '',
                            solution_text: s.solution_text || next[s.question_id]?.solution_text || '',
                            difficulty: s.difficulty || next[s.question_id]?.difficulty || '',
                            tags: s.tags || next[s.question_id]?.tags || '',
                        };
                    }
                    return next;
                });
                setFeedback({ type: 'success', message: `AI solved ${data.solutions.length} questions. Review and save.` });
            } else {
                setFeedback({ type: 'error', message: data.error || 'AI generation failed.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error during AI generation.' });
        } finally {
            setIsSolving(false);
        }
    };

    const handleSaveAll = async () => {
        if (!selectedPaper) return;
        setIsSaving(true);
        setFeedback(null);
        try {
            const solutionsArray = questions.map(q => ({
                question_id: q.question_id,
                version_no: q.version_no,
                answer_label: solutions[q.question_id]?.answer_label || '',
                solution_text: solutions[q.question_id]?.solution_text || '',
                difficulty: solutions[q.question_id]?.difficulty || '',
                tags: solutions[q.question_id]?.tags || '',
            }));

            const res = await fetch('/api/solution-review/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paper_session_id: selectedPaper.paper_session_id,
                    solutions: solutionsArray,
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', message: `Saved ${data.saved} questions` });
            } else {
                setFeedback({ type: 'error', message: data.error || 'Save failed.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error during save.' });
        } finally {
            setIsSaving(false);
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    return (
        <div className="flex h-screen overflow-hidden bg-white">
            {/* Left Sidebar */}
            <aside className="w-72 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
                <div className="px-4 py-4 border-b border-gray-200">
                    <h1 className="text-lg font-bold text-gray-900">Solution Review</h1>
                    <p className="text-xs text-gray-500 mt-0.5">{papers.length} papers ready</p>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {papers.length === 0 ? (
                        <div className="p-4 text-sm text-gray-400 italic text-center mt-8">
                            No papers in MISSING_ADDED status.
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
                                                <span className="text-xs font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                                    {parseInt(paper.question_count || 0)} Qs
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
                            <h2 className="text-xl font-semibold text-gray-700">Select a paper to begin</h2>
                            <p className="text-gray-400 mt-2 text-sm">Choose a paper from the left sidebar to review and fill in solutions.</p>
                        </div>
                    </div>
                ) : (
                    <div>
                        {/* Sticky top bar */}
                        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm px-6 py-3 flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <h2 className="text-base font-bold text-gray-900 truncate">{selectedPaper.session_label}</h2>
                                <p className="text-xs text-gray-500">
                                    {selectedPaper.subject} &middot; {formatDate(selectedPaper.paper_date)} &middot; {questions.length} questions
                                </p>
                            </div>
                            {feedback && (
                                <div className={`text-sm px-3 py-1.5 rounded font-medium ${feedback.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                                    {feedback.message}
                                </div>
                            )}
                            <div className="flex gap-2 flex-shrink-0">
                                <button
                                    onClick={handleSolveWithAI}
                                    disabled={isSolving || loadingQuestions || questions.length === 0}
                                    className="px-4 py-2 bg-violet-600 text-white text-sm font-semibold rounded-md hover:bg-violet-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                                >
                                    {isSolving ? (
                                        <>
                                            <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                                            Solving...
                                        </>
                                    ) : (
                                        '✨ Solve with AI'
                                    )}
                                </button>
                                <button
                                    onClick={handleSaveAll}
                                    disabled={isSaving || loadingQuestions || questions.length === 0}
                                    className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                                >
                                    {isSaving ? (
                                        <>
                                            <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                                            Saving...
                                        </>
                                    ) : (
                                        '💾 Save All'
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Questions */}
                        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
                            {loadingQuestions ? (
                                <div className="flex items-center justify-center py-24">
                                    <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
                                    <span className="ml-3 text-gray-500">Loading questions...</span>
                                </div>
                            ) : questions.length === 0 ? (
                                <div className="text-center py-24 text-gray-400">No questions found for this paper.</div>
                            ) : (
                                questions.map((q, idx) => {
                                    const sol = solutions[q.question_id] || {};
                                    return (
                                        <div key={q.question_id} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                                            {/* Question Header */}
                                            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                                                <span className="text-sm font-bold text-gray-700">
                                                    Q.{q.source_q_no || idx + 1}
                                                </span>
                                                <span className="text-xs text-gray-400 font-mono">{q.question_id}</span>
                                            </div>

                                            {/* Question Text */}
                                            <div className="px-5 py-4 border-b border-gray-100">
                                                <div className="text-sm text-gray-800">
                                                    <Latex>{q.question_text || '(No question text)'}</Latex>
                                                </div>
                                            </div>

                                            {/* Options Grid */}
                                            <div className="px-5 py-4 border-b border-gray-100 grid grid-cols-2 gap-3">
                                                {(q.options || []).map(opt => {
                                                    const isCorrect = sol.answer_label === opt.opt_label;
                                                    return (
                                                        <div
                                                            key={opt.opt_label}
                                                            className={`flex gap-2 items-start p-3 rounded-md border transition-colors ${isCorrect ? 'bg-green-50 border-green-400' : 'bg-white border-gray-200'}`}
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

                                            {/* Solution Fields */}
                                            <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap gap-4 items-end">
                                                <div className="flex flex-col gap-1">
                                                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Answer</label>
                                                    <select
                                                        value={sol.answer_label || ''}
                                                        onChange={e => updateSolution(q.question_id, 'answer_label', e.target.value)}
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
                                                        value={sol.difficulty || ''}
                                                        onChange={e => updateSolution(q.question_id, 'difficulty', e.target.value)}
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
                                                        value={sol.tags || ''}
                                                        onChange={e => updateSolution(q.question_id, 'tags', e.target.value)}
                                                        placeholder="e.g. algebra, quadratic"
                                                        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                    />
                                                </div>
                                            </div>

                                            {/* Solution Textarea */}
                                            <div className="px-5 py-4">
                                                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1.5">Solution</label>
                                                <textarea
                                                    rows={4}
                                                    value={sol.solution_text || ''}
                                                    onChange={e => updateSolution(q.question_id, 'solution_text', e.target.value)}
                                                    placeholder="Detailed step-by-step solution with tricks..."
                                                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                                                />
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
