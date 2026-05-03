'use client';

import { useState } from 'react';
import Link from 'next/link';
import Latex from '@/components/Latex';
import BilingualList from '@/components/BilingualList';

export default function QuestionReviewPage() {
    const [questionId, setQuestionId] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [flaggedQuestions, setFlaggedQuestions] = useState([]);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!questionId.trim()) return;

        setLoading(true);
        setError('');
        setResult(null);
        setFlaggedQuestions([]);

        try {
            const res = await fetch(`/api/question-review?questionId=${encodeURIComponent(questionId.trim())}`);
            const data = await res.json();

            if (res.ok && data.success) {
                setResult(data.data);

                // Fetch flagged questions for this session
                const sessionId = data.data.english_paper_session_id || data.data.hindi_paper_session_id;
                if (sessionId) {
                    try {
                        const flaggedRes = await fetch(`/api/question-review/flagged?paperSessionId=${sessionId}`);
                        const flaggedData = await flaggedRes.json();
                        if (flaggedRes.ok && flaggedData.success) {
                            setFlaggedQuestions(flaggedData.data);
                        }
                    } catch (err) {
                        console.error('Error fetching flagged questions:', err);
                    }
                }
            } else {
                setError(data.error || 'Question not found or an error occurred.');
            }
        } catch (err) {
            console.error(err);
            setError('Failed to fetch question data. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Helper to safely render LaTeX content from JSON body
    const renderHtmlContent = (htmlString) => {
        if (!htmlString) return '';
        // If it's already a string, return it directly inside Latex
        return <Latex>{htmlString}</Latex>;
    };

    return (
        <div className="container mx-auto px-4 py-8 max-w-7xl">
            <header className="mb-8 flex justify-between items-center border-b pb-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Question Review Tab</h1>
                    <p className="text-gray-500 mt-1">
                        Search by English or Hindi Question ID to view their bilingual pair.
                    </p>
                </div>
                <Link href="/dashboard" className="text-blue-600 hover:text-blue-800 font-medium">
                    ← Back to Dashboard
                </Link>
            </header>

            {/* Search Section */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-8">
                <form onSubmit={handleSearch} className="flex gap-4 items-center">
                    <div className="flex-1">
                        <label htmlFor="questionId" className="block text-sm font-medium text-gray-700 mb-1">
                            Enter Question ID (English or Hindi)
                        </label>
                        <input
                            type="text"
                            id="questionId"
                            value={questionId}
                            onChange={(e) => setQuestionId(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                            placeholder="e.g. 32a06b87-e61b-4acc-8fff-ce72a9968efe"
                            required
                        />
                    </div>
                    <div className="pt-6">
                        <button
                            type="submit"
                            disabled={loading || !questionId.trim()}
                            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                        >
                            {loading ? 'Searching...' : 'Search →'}
                        </button>
                    </div>
                </form>

                {error && (
                    <div className="mt-4 p-4 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm font-medium">
                        {error}
                    </div>
                )}
            </div>

            {/* Results Section */}
            {result && (
                <div className="space-y-6 animate-fade-in">

                    {/* Solo indicator */}
                    {(!result.english_question_id || !result.hindi_question_id) && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 font-medium">
                            This question is not linked to a bilingual pair. Showing {result.english_question_id ? 'English' : 'Hindi'} only.
                        </div>
                    )}

                    {/* Top Metadata row */}
                    <div className={`grid grid-cols-1 ${result.english_question_id && result.hindi_question_id ? 'md:grid-cols-2' : ''} gap-6`}>
                        {result.english_question_id && <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">English</span>
                                <span className="text-xs font-mono text-gray-400">{result.english_question_id}</span>
                            </div>
                            <div className="text-sm text-gray-700 space-y-1">
                                {result.english_exam_name && <div><span className="font-semibold text-blue-700">{result.english_exam_name}</span></div>}
                                {result.english_session_label && <div className="text-xs">{result.english_session_label}</div>}
                                <div className="flex gap-3 text-xs text-gray-500 items-center flex-wrap">
                                    {result.english_paper_date && <span>{new Date(result.english_paper_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                                    {result.english_shift_label && <span>Shift: {result.english_shift_label}</span>}
                                    {result.english_section_code && <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{result.english_section_code}</span>}
                                    {result.english_source_qno && <span>Q.{result.english_source_qno}</span>}
                                    {!result.english_source_qno && result.english_qno && <span>Q.{result.english_qno}</span>}
                                    {result.english_pdf_path ? (
                                        <a href={`/api/pdf?path=${encodeURIComponent(result.english_pdf_path)}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="ml-auto text-xs font-semibold px-2 py-0.5 rounded border border-blue-300 text-blue-700 bg-white hover:bg-blue-50">
                                            Open Source PDF ↗
                                        </a>
                                    ) : (
                                        <span className="ml-auto text-xs italic text-gray-400">No PDF linked</span>
                                    )}
                                </div>
                            </div>
                        </div>}

                        {result.hindi_question_id && <div className="bg-orange-50 p-4 rounded-lg border border-orange-100">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-orange-800 uppercase tracking-wider">Hindi</span>
                                <span className="text-xs font-mono text-gray-400">{result.hindi_question_id}</span>
                            </div>
                            <div className="text-sm text-gray-700 space-y-1">
                                {result.hindi_exam_name && <div><span className="font-semibold text-orange-700">{result.hindi_exam_name}</span></div>}
                                {result.hindi_session_label && <div className="text-xs">{result.hindi_session_label}</div>}
                                <div className="flex gap-3 text-xs text-gray-500 items-center flex-wrap">
                                    {result.hindi_paper_date && <span>{new Date(result.hindi_paper_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                                    {result.hindi_shift_label && <span>Shift: {result.hindi_shift_label}</span>}
                                    {result.hindi_section_code && <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{result.hindi_section_code}</span>}
                                    {result.hindi_source_qno && <span>Q.{result.hindi_source_qno}</span>}
                                    {!result.hindi_source_qno && result.hindi_qno && <span>Q.{result.hindi_qno}</span>}
                                    {result.hindi_pdf_path ? (
                                        <a href={`/api/pdf?path=${encodeURIComponent(result.hindi_pdf_path)}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="ml-auto text-xs font-semibold px-2 py-0.5 rounded border border-orange-300 text-orange-700 bg-white hover:bg-orange-50">
                                            Open Source PDF ↗
                                        </a>
                                    ) : (
                                        <span className="ml-auto text-xs italic text-gray-400">No PDF linked</span>
                                    )}
                                </div>
                            </div>
                        </div>}
                    </div>

                    {/* Question Body Row side by side */}
                    <div className={`grid grid-cols-1 ${result.english_question_id && result.hindi_question_id ? 'md:grid-cols-2' : ''} gap-6 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden`}>

                        {/* English Side */}
                        {result.english_question_id && <div className="p-6 border-r border-gray-200">
                            <div className="mb-4 pb-2 border-b border-gray-100 flex items-center justify-between">
                                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                    <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm">EN</span>
                                    English Question
                                </h2>
                            </div>

                            <div className="prose prose-sm max-w-none text-gray-800 bg-gray-50 p-4 rounded-md border border-gray-100 min-h-[150px]">
                                {renderHtmlContent(result.english_question_stem)}
                            </div>

                            <div className="mt-6 space-y-3">
                                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Options</h3>
                                {result.english_options && Object.entries(result.english_options).map(([key, value]) => {
                                    const isCorrect = result.english_correct === key;
                                    return (
                                    <div key={`en-${key}`} className={`flex gap-3 p-3 rounded-md shadow-sm transition-colors ${isCorrect ? 'bg-green-50 border-2 border-green-400' : 'bg-white border border-gray-200 hover:border-blue-300'}`}>
                                        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${isCorrect ? 'bg-green-500 text-white border-green-500' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                                            {key}
                                        </div>
                                        <div className="text-sm text-gray-700 pt-0.5">
                                            {renderHtmlContent(value)}
                                        </div>
                                    </div>
                                    );
                                })}
                                {(!result.english_options || Object.keys(result.english_options).length === 0) && (
                                    <div className="text-sm text-gray-400 italic">No options found.</div>
                                )}
                            </div>

                            {/* EN Answer & Solution */}
                            {(result.english_correct || result.english_solution_status === 'DONE') && (
                                <div className="mt-6 space-y-3">
                                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Answer & Solution</h3>
                                    <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                                        <div className="flex items-center gap-3 mb-2">
                                            {result.english_correct && (
                                                <span className="text-sm font-bold text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full">
                                                    Answer: {result.english_correct}
                                                </span>
                                            )}
                                            {result.english_difficulty && (
                                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${result.english_difficulty === 1 ? 'bg-green-100 text-green-700' : result.english_difficulty === 2 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                                    {result.english_difficulty === 1 ? 'Easy' : result.english_difficulty === 2 ? 'Medium' : 'Hard'}
                                                </span>
                                            )}
                                            {result.english_subtype && (
                                                <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{result.english_subtype}</span>
                                            )}
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${result.english_solution_status === 'DONE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                                {result.english_solution_status || 'PENDING'}
                                            </span>
                                        </div>
                                        {result.english_solution_json?.answer_outcome?.core_answer_basis && (
                                            <div className="text-xs text-gray-700 mb-2">
                                                <span className="font-semibold text-gray-500">Core Basis: </span>
                                                <Latex>{result.english_solution_json.answer_outcome.core_answer_basis}</Latex>
                                            </div>
                                        )}
                                        {(result.english_solution_json?.display_sections || []).map((sec, i) => (
                                            <div key={i} className="mb-2">
                                                <div className="text-xs font-bold text-gray-600 uppercase mb-0.5">{(sec.key || '').replace(/_/g, ' ')}</div>
                                                <div className="text-xs text-gray-700"><Latex>{sec.content || ''}</Latex></div>
                                            </div>
                                        ))}
                                        {result.english_solution_json?.answer_outcome?.figure_url && (
                                            <div className="mt-2">
                                                <div className="text-xs font-bold text-gray-600 uppercase mb-1">Figure</div>
                                                <img src={result.english_solution_json.answer_outcome.figure_url} alt="Solution figure"
                                                    className="max-h-48 rounded border border-gray-300 object-contain" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>}

                        {/* Hindi Side */}
                        {result.hindi_question_id && <div className="p-6">
                            <div className="mb-4 pb-2 border-b border-gray-100 flex items-center justify-between">
                                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                    <span className="w-8 h-8 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-sm">HI</span>
                                    Hindi Question
                                </h2>
                            </div>

                            <div className="prose prose-sm max-w-none text-gray-800 bg-gray-50 p-4 rounded-md border border-gray-100 min-h-[150px]">
                                {renderHtmlContent(result.hindi_question_stem)}
                            </div>

                            <div className="mt-6 space-y-3">
                                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Options</h3>
                                {result.hindi_options && Object.entries(result.hindi_options).map(([key, value]) => {
                                    const isCorrect = result.hindi_correct === key;
                                    return (
                                    <div key={`hi-${key}`} className={`flex gap-3 p-3 rounded-md shadow-sm transition-colors ${isCorrect ? 'bg-green-50 border-2 border-green-400' : 'bg-white border border-gray-200 hover:border-orange-300'}`}>
                                        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${isCorrect ? 'bg-green-500 text-white border-green-500' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                                            {key}
                                        </div>
                                        <div className="text-sm text-gray-700 pt-0.5">
                                            {renderHtmlContent(value)}
                                        </div>
                                    </div>
                                    );
                                })}
                                {(!result.hindi_options || Object.keys(result.hindi_options).length === 0) && (
                                    <div className="text-sm text-gray-400 italic">No options found.</div>
                                )}
                            </div>

                            {/* HI Answer & Solution */}
                            {(result.hindi_correct || result.hindi_solution_status === 'DONE') && (
                                <div className="mt-6 space-y-3">
                                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Answer & Solution</h3>
                                    <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                                        <div className="flex items-center gap-3 mb-2">
                                            {result.hindi_correct && (
                                                <span className="text-sm font-bold text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full">
                                                    Answer: {result.hindi_correct}
                                                </span>
                                            )}
                                            {result.hindi_difficulty && (
                                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${result.hindi_difficulty === 1 ? 'bg-green-100 text-green-700' : result.hindi_difficulty === 2 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                                    {result.hindi_difficulty === 1 ? 'Easy' : result.hindi_difficulty === 2 ? 'Medium' : 'Hard'}
                                                </span>
                                            )}
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${result.hindi_solution_status === 'DONE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                                {result.hindi_solution_status || 'PENDING'}
                                            </span>
                                        </div>
                                        {result.hindi_solution_json?.answer_outcome?.core_answer_basis && (
                                            <div className="text-xs text-gray-700 mb-2">
                                                <span className="font-semibold text-gray-500">Core Basis: </span>
                                                <Latex>{result.hindi_solution_json.answer_outcome.core_answer_basis}</Latex>
                                            </div>
                                        )}
                                        {(result.hindi_solution_json?.display_sections || []).map((sec, i) => (
                                            <div key={i} className="mb-2">
                                                <div className="text-xs font-bold text-gray-600 uppercase mb-0.5">{(sec.key || '').replace(/_/g, ' ')}</div>
                                                <div className="text-xs text-gray-700"><Latex>{sec.content || ''}</Latex></div>
                                            </div>
                                        ))}
                                        {result.hindi_solution_json?.answer_outcome?.figure_url && (
                                            <div className="mt-2">
                                                <div className="text-xs font-bold text-gray-600 uppercase mb-1">Figure</div>
                                                <img src={result.hindi_solution_json.answer_outcome.figure_url} alt="Solution figure"
                                                    className="max-h-48 rounded border border-gray-300 object-contain" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>}

                    </div>
                </div>
            )}

            {/* Flagged Editor Section */}
            {result && flaggedQuestions.length > 0 && (
                <div className="mt-12 border-t pt-8 animate-fade-in">
                    <h2 className="text-2xl font-bold text-gray-900 mb-6">Other "Marked for Review" Questions in this Session</h2>
                    <BilingualList
                        initialQuestions={flaggedQuestions}
                        total={flaggedQuestions.length}
                        currentPage={1}
                        totalPages={1}
                        paperSessionId={result.english_paper_session_id || result.hindi_paper_session_id}
                        engSessionId={result.english_paper_session_id}
                        hinSessionId={result.hindi_paper_session_id}
                        isReviewMode={true}
                    />
                </div>
            )}
        </div>
    );
}
