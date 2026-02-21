'use client';

import { useState } from 'react';
import Link from 'next/link';
import Latex from '@/components/Latex';

export default function QuestionReviewPage() {
    const [questionId, setQuestionId] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!questionId.trim()) return;

        setLoading(true);
        setError('');
        setResult(null);

        try {
            const res = await fetch(`/api/question-review?questionId=${encodeURIComponent(questionId.trim())}`);
            const data = await res.json();

            if (res.ok && data.success) {
                setResult(data.data);
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

                    {/* Top Metadata row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 flex justify-between items-center">
                            <div>
                                <span className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-1 block">English Metadata</span>
                                <div className="text-sm text-gray-700 font-mono">
                                    ID: <span className="font-semibold">{result.english_question_id}</span><br />
                                    Paper Session: {result.english_paper_session_id}<br />
                                    Q.No: {result.english_qno}
                                </div>
                            </div>
                        </div>

                        <div className="bg-orange-50 p-4 rounded-lg border border-orange-100 flex justify-between items-center">
                            <div>
                                <span className="text-xs font-bold text-orange-800 uppercase tracking-wider mb-1 block">Hindi Metadata</span>
                                <div className="text-sm text-gray-700 font-mono">
                                    ID: <span className="font-semibold">{result.hindi_question_id}</span><br />
                                    Paper Session: {result.hindi_paper_session_id}<br />
                                    Q.No: {result.hindi_qno}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Question Body Row side by side */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">

                        {/* English Side */}
                        <div className="p-6 border-r border-gray-200">
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
                                {result.english_options && Object.entries(result.english_options).map(([key, value]) => (
                                    <div key={`en-${key}`} className="flex gap-3 p-3 bg-white border border-gray-200 rounded-md shadow-sm hover:border-blue-300 transition-colors">
                                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center text-xs font-bold">
                                            {key}
                                        </div>
                                        <div className="text-sm text-gray-700 pt-0.5">
                                            {renderHtmlContent(value)}
                                        </div>
                                    </div>
                                ))}
                                {(!result.english_options || Object.keys(result.english_options).length === 0) && (
                                    <div className="text-sm text-gray-400 italic">No options found.</div>
                                )}
                            </div>
                        </div>

                        {/* Hindi Side */}
                        <div className="p-6">
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
                                {result.hindi_options && Object.entries(result.hindi_options).map(([key, value]) => (
                                    <div key={`hi-${key}`} className="flex gap-3 p-3 bg-white border border-gray-200 rounded-md shadow-sm hover:border-orange-300 transition-colors">
                                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-50 text-orange-700 border border-orange-200 flex items-center justify-center text-xs font-bold">
                                            {key}
                                        </div>
                                        <div className="text-sm text-gray-700 pt-0.5">
                                            {renderHtmlContent(value)}
                                        </div>
                                    </div>
                                ))}
                                {(!result.hindi_options || Object.keys(result.hindi_options).length === 0) && (
                                    <div className="text-sm text-gray-400 italic">No options found.</div>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            )}
        </div>
    );
}
