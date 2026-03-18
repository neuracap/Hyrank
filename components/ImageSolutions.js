'use client';

import { useState } from 'react';
import Latex from '@/components/Latex';

export default function ImageSolutions({ papers }) {
    const [selectedPaper, setSelectedPaper] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [solutions, setSolutions] = useState({});
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [savingId, setSavingId] = useState(null);
    const [feedback, setFeedback] = useState(null);
    const [filter, setFilter] = useState('unsolved'); // 'all' | 'unsolved' | 'solved'

    const handlePaperClick = async (paper) => {
        setSelectedPaper(paper);
        setQuestions([]);
        setSolutions({});
        setFeedback(null);
        setLoadingQuestions(true);

        try {
            const res = await fetch(`/api/image-solutions/questions?paperId=${paper.paper_session_id}`);
            const data = await res.json();
            if (res.ok && data.questions) {
                setQuestions(data.questions);
                const initial = {};
                for (const q of data.questions) {
                    initial[q.question_id] = {
                        answer_label: q.answer_label || '',
                        solution_text: q.solution_text || '',
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

    const handleSave = async (q) => {
        const sol = solutions[q.question_id];
        if (!sol?.answer_label) {
            setFeedback({ type: 'error', message: 'Please select an answer before saving.' });
            return;
        }

        setSavingId(q.question_id);
        setFeedback(null);

        try {
            const res = await fetch('/api/image-solutions/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: q.question_id,
                    version_no: q.version_no,
                    answer_label: sol.answer_label,
                    solution_text: sol.solution_text || '',
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', message: `Q.${q.source_q_no || q.question_id.slice(0, 6)} saved!` });
                // Update the question's original answer_label so filter works
                setQuestions(prev => prev.map(pq =>
                    pq.question_id === q.question_id
                        ? { ...pq, answer_label: sol.answer_label, solution_text: sol.solution_text }
                        : pq
                ));
            } else {
                setFeedback({ type: 'error', message: data.error || 'Save failed.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error during save.' });
        } finally {
            setSavingId(null);
        }
    };

    // Extract image URLs from question text (\includegraphics{url})
    const extractImages = (text) => {
        if (!text) return [];
        const regex = /\\includegraphics\{([^}]+)\}/g;
        const urls = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            urls.push(match[1]);
        }
        return urls;
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const filteredQuestions = questions.filter(q => {
        if (filter === 'unsolved') return !q.answer_label;
        if (filter === 'solved') return !!q.answer_label;
        return true;
    });

    return (
        <div className="flex h-screen overflow-hidden bg-white">
            {/* Left Sidebar */}
            <aside className="w-72 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
                <div className="px-4 py-4 border-b border-gray-200">
                    <h1 className="text-lg font-bold text-gray-900">Img Sol</h1>
                    <p className="text-xs text-gray-500 mt-0.5">{papers.length} papers with image questions</p>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {papers.length === 0 ? (
                        <div className="p-4 text-sm text-gray-400 italic text-center mt-8">
                            No papers with image questions found.
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {papers.map(paper => {
                                const isSelected = selectedPaper?.paper_session_id === paper.paper_session_id;
                                const total = parseInt(paper.image_question_count || 0);
                                const solved = parseInt(paper.solved_count || 0);
                                const allDone = total > 0 && solved === total;
                                return (
                                    <li key={paper.paper_session_id}>
                                        <button
                                            onClick={() => handlePaperClick(paper)}
                                            className={`w-full text-left px-4 py-3 transition-colors hover:bg-orange-50 ${isSelected ? 'bg-orange-100 border-l-4 border-orange-500' : 'border-l-4 border-transparent'}`}
                                        >
                                            <div className="text-sm font-semibold text-gray-900 truncate">{paper.session_label}</div>
                                            {paper.exam_name && (
                                                <div className="text-xs text-indigo-600 mt-0.5 truncate">{paper.exam_name}</div>
                                            )}
                                            <div className="text-xs text-gray-500 mt-0.5">{paper.subject || 'No subject'}</div>
                                            <div className="flex items-center justify-between mt-1">
                                                <span className="text-xs text-gray-400">{formatDate(paper.paper_date)}</span>
                                                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${allDone ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                                    {solved}/{total} done
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
                            <div className="text-5xl mb-4">🖼️</div>
                            <h2 className="text-xl font-semibold text-gray-700">Select a paper to review</h2>
                            <p className="text-gray-400 mt-2 text-sm">Choose a paper from the left to review image questions and provide answers.</p>
                        </div>
                    </div>
                ) : (
                    <div>
                        {/* Sticky top bar */}
                        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm px-6 py-3 flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <h2 className="text-base font-bold text-gray-900 truncate">{selectedPaper.session_label}</h2>
                                <p className="text-xs text-gray-500">
                                    {selectedPaper.subject} &middot; {formatDate(selectedPaper.paper_date)} &middot; {filteredQuestions.length} showing
                                </p>
                            </div>
                            {feedback && (
                                <div className={`text-sm px-3 py-1.5 rounded font-medium ${feedback.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                                    {feedback.message}
                                </div>
                            )}
                            <div className="flex gap-1 flex-shrink-0">
                                {['unsolved', 'all', 'solved'].map(f => (
                                    <button
                                        key={f}
                                        onClick={() => setFilter(f)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${filter === f
                                            ? 'bg-orange-600 text-white'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                    >
                                        {f.charAt(0).toUpperCase() + f.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Questions */}
                        <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
                            {loadingQuestions ? (
                                <div className="flex items-center justify-center py-24">
                                    <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full"></div>
                                    <span className="ml-3 text-gray-500">Loading image questions...</span>
                                </div>
                            ) : filteredQuestions.length === 0 ? (
                                <div className="text-center py-24 text-gray-400">
                                    {filter === 'unsolved' ? 'All image questions are solved!' : 'No image questions found.'}
                                </div>
                            ) : (
                                filteredQuestions.map((q, idx) => {
                                    const sol = solutions[q.question_id] || {};
                                    const images = extractImages(q.question_text);
                                    const isSaved = !!q.answer_label;
                                    const isSaving = savingId === q.question_id;

                                    return (
                                        <div key={q.question_id} className={`bg-white rounded-lg border shadow-sm overflow-hidden ${isSaved ? 'border-green-300' : 'border-gray-200'}`}>
                                            {/* Question Header */}
                                            <div className={`px-5 py-3 border-b flex items-center justify-between ${isSaved ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'}`}>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-bold text-gray-700">
                                                        Q.{q.source_q_no || idx + 1}
                                                    </span>
                                                    <span className="text-xs text-gray-400 font-mono">{q.question_id.slice(0, 8)}</span>
                                                    {isSaved && (
                                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">Solved</span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Image + Question Layout */}
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
                                                {/* Left: Images */}
                                                <div className="p-5 border-b lg:border-b-0 lg:border-r border-gray-100 bg-gray-50 flex flex-col gap-3">
                                                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Question Image</label>
                                                    {images.length > 0 ? (
                                                        images.map((url, i) => (
                                                            <img
                                                                key={i}
                                                                src={url}
                                                                alt={`Q.${q.source_q_no || idx + 1} figure ${i + 1}`}
                                                                className="max-w-full rounded border border-gray-200 bg-white"
                                                                style={{ maxHeight: '400px', objectFit: 'contain' }}
                                                            />
                                                        ))
                                                    ) : q.assets && q.assets.length > 0 ? (
                                                        q.assets.map((asset, i) => (
                                                            <img
                                                                key={i}
                                                                src={asset.image_url}
                                                                alt={`Q.${q.source_q_no || idx + 1} asset ${i + 1}`}
                                                                className="max-w-full rounded border border-gray-200 bg-white"
                                                                style={{ maxHeight: '400px', objectFit: 'contain' }}
                                                            />
                                                        ))
                                                    ) : (
                                                        <div className="text-sm text-gray-400 italic py-8 text-center">No image found in assets</div>
                                                    )}
                                                </div>

                                                {/* Right: Question text + Options */}
                                                <div className="flex flex-col">
                                                    {/* Question text */}
                                                    <div className="px-5 py-4 border-b border-gray-100">
                                                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Question</label>
                                                        <div className="text-sm text-gray-800">
                                                            <Latex>{q.question_text || '(No question text)'}</Latex>
                                                        </div>
                                                    </div>

                                                    {/* Options - clickable to select answer */}
                                                    <div className="px-5 py-4">
                                                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Options (click to select answer)</label>
                                                        <div className="grid grid-cols-1 gap-2">
                                                            {(q.options || []).map(opt => {
                                                                const isSelected = sol.answer_label === opt.opt_label;
                                                                return (
                                                                    <button
                                                                        key={opt.opt_label}
                                                                        onClick={() => updateSolution(q.question_id, 'answer_label', opt.opt_label)}
                                                                        className={`flex gap-2 items-start p-3 rounded-md border text-left transition-all ${isSelected
                                                                            ? 'bg-green-50 border-green-400 ring-2 ring-green-300'
                                                                            : 'bg-white border-gray-200 hover:border-gray-400 hover:bg-gray-50'
                                                                        }`}
                                                                    >
                                                                        <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border ${isSelected
                                                                            ? 'bg-green-500 text-white border-green-500'
                                                                            : 'bg-gray-100 text-gray-600 border-gray-300'
                                                                        }`}>
                                                                            {opt.opt_label}
                                                                        </span>
                                                                        <div className="text-sm text-gray-700 pt-0.5 flex-1">
                                                                            <Latex>{opt.opt_text || ''}</Latex>
                                                                        </div>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Solution + Save */}
                                            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50">
                                                <div className="flex gap-4 items-end">
                                                    <div className="flex-1">
                                                        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1.5">Explanation / Solution</label>
                                                        <textarea
                                                            rows={3}
                                                            value={sol.solution_text || ''}
                                                            onChange={e => updateSolution(q.question_id, 'solution_text', e.target.value)}
                                                            placeholder="Enter step-by-step explanation for this question..."
                                                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-y"
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={() => handleSave(q)}
                                                        disabled={isSaving || !sol.answer_label}
                                                        className="px-5 py-2.5 bg-orange-600 text-white text-sm font-semibold rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors flex items-center gap-1.5 flex-shrink-0"
                                                    >
                                                        {isSaving ? (
                                                            <>
                                                                <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                                                                Saving...
                                                            </>
                                                        ) : (
                                                            'Save'
                                                        )}
                                                    </button>
                                                </div>
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
