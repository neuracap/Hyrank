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
        setLoadingQuestions(true);

        try {
            const res = await fetch(`/api/solution-review/questions?paperId=${paper.paper_session_id}`);
            const data = await res.json();
            if (res.ok && data.questions) {
                setQuestions(data.questions);
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

    const handleMarkReviewed = async () => {
        if (!selectedPaper) return;
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
                // Remove from sidebar and clear selection
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

    return (
        <div className="flex h-screen overflow-hidden bg-white">
            {/* Left Sidebar — Papers with complete solutions */}
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
                            <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-1 rounded">
                                Status: {selectedPaper.status}
                            </span>
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
                                    questions.map((q, idx) => (
                                        <div key={q.question_id} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                                            {/* Question Header */}
                                            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                                                <span className="text-sm font-bold text-gray-700">
                                                    Q.{q.source_q_no || idx + 1}
                                                </span>
                                                <div className="flex items-center gap-3">
                                                    {q.difficulty && (
                                                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                                                            q.difficulty === 'easy' ? 'bg-green-100 text-green-700' :
                                                            q.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                                            'bg-red-100 text-red-700'
                                                        }`}>
                                                            {q.difficulty}
                                                        </span>
                                                    )}
                                                    {q.answer_label && (
                                                        <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                                            Ans: {q.answer_label}
                                                        </span>
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
                                                    const isCorrect = q.answer_label === opt.opt_label;
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

                                            {/* Solution */}
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
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Bottom bar with Solution Reviewed button */}
                        {questions.length > 0 && !loadingQuestions && (
                            <div className="sticky bottom-0 bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] px-6 py-4 flex items-center justify-between">
                                <div className="text-sm text-gray-500">
                                    {questions.length} questions reviewed
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
