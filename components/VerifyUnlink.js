'use client';

import { useState } from 'react';
import Link from 'next/link';
import Latex from './Latex';

function QuestionCard({ question, onVerified }) {
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [verified, setVerified] = useState(false);
    const [editedText, setEditedText] = useState(question.question_text || '');
    const [editedOptions, setEditedOptions] = useState(question.options.map(o => ({ ...o })));

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const res = await fetch('/api/verify-unlink/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: question.id,
                    version_no: question.version_no,
                    language: question.language,
                    question_text: editedText,
                    options: editedOptions
                })
            });
            const data = await res.json();
            if (data.success) {
                setIsEditing(false);
                setVerified(true);
                onVerified(question.id);
            } else {
                alert('Save failed: ' + data.error);
            }
        } catch (e) {
            alert('Error saving: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleMarkVerified = async () => {
        // Save without edits — just marks is_verified = TRUE
        setIsSaving(true);
        try {
            const res = await fetch('/api/verify-unlink/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: question.id,
                    version_no: question.version_no,
                    language: question.language,
                    question_text: question.question_text,
                    options: question.options
                })
            });
            const data = await res.json();
            if (data.success) {
                setVerified(true);
                onVerified(question.id);
            } else {
                alert('Failed: ' + data.error);
            }
        } catch (e) {
            alert('Error: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    if (verified) return null;

    return (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 mb-4">
            {/* Header: session label + source Q no + PDF link */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
                        {question.session_label || question.paper_session_id}
                    </span>
                    {question.source_question_no && (
                        <span className="text-xs text-gray-500 font-mono">
                            Q{question.source_question_no}
                        </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded font-bold ${question.language === 'EN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}`}>
                        {question.language}
                    </span>
                    {question.exam_name && (
                        <span className="text-xs text-gray-400">{question.exam_name}</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {question.source_pdf_path && (
                        <a
                            href={`/api/pdf?path=${encodeURIComponent(question.source_pdf_path)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded text-xs shadow-sm"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-gray-500">
                                <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" />
                                <path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" />
                            </svg>
                            Source PDF
                        </a>
                    )}
                    {/* Mark Verified without editing */}
                    {!isEditing && (
                        <button
                            onClick={handleMarkVerified}
                            disabled={isSaving}
                            className="px-3 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 transition-colors disabled:opacity-50"
                        >
                            {isSaving ? 'Saving...' : '✓ Mark Verified'}
                        </button>
                    )}
                    {/* Edit button */}
                    {!isEditing && (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="px-3 py-1 text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200 rounded hover:bg-gray-200 transition-colors"
                        >
                            Edit
                        </button>
                    )}
                </div>
            </div>

            {/* Question Body */}
            <div className="mb-4">
                {isEditing ? (
                    <textarea
                        className="w-full border border-gray-300 rounded-lg p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300 min-h-[100px] resize-y"
                        value={editedText}
                        onChange={e => setEditedText(e.target.value)}
                    />
                ) : (
                    <div className="text-gray-800 text-sm leading-relaxed">
                        <Latex>{question.question_text || ''}</Latex>
                    </div>
                )}
            </div>

            {/* Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                {(isEditing ? editedOptions : question.options).map((opt, idx) => (
                    <div key={opt.opt_label} className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center mt-0.5">
                            {opt.opt_label}
                        </span>
                        {isEditing ? (
                            <textarea
                                className="flex-1 border border-gray-300 rounded p-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-300 resize-y min-h-[40px]"
                                value={opt.opt_text || ''}
                                onChange={e => {
                                    const newOpts = [...editedOptions];
                                    newOpts[idx] = { ...newOpts[idx], opt_text: e.target.value };
                                    setEditedOptions(newOpts);
                                }}
                            />
                        ) : (
                            <span className="text-sm text-gray-700">
                                <Latex>{opt.opt_text || ''}</Latex>
                            </span>
                        )}
                    </div>
                ))}
            </div>

            {/* Edit mode action buttons */}
            {isEditing && (
                <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                        {isSaving ? 'Saving...' : 'Save & Verify'}
                    </button>
                    <button
                        onClick={() => {
                            setEditedText(question.question_text || '');
                            setEditedOptions(question.options.map(o => ({ ...o })));
                            setIsEditing(false);
                        }}
                        disabled={isSaving}
                        className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200 transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
}

export default function VerifyUnlink({ initialQuestions, total, currentPage, totalPages }) {
    const [questions, setQuestions] = useState(initialQuestions);
    const [remaining, setRemaining] = useState(total);

    const handleVerified = (questionId) => {
        setQuestions(prev => prev.filter(q => q.id !== questionId));
        setRemaining(prev => prev - 1);
    };

    const buildPageUrl = (p) => `/verify-unlink?page=${p}`;

    return (
        <div>
            {/* Remaining count */}
            <div className="mb-4 text-sm text-gray-500">
                <span className="font-semibold text-gray-800">{remaining}</span> question{remaining !== 1 ? 's' : ''} remaining on this page
                {totalPages > 1 && (
                    <span className="ml-2 text-gray-400">— Page {currentPage} of {totalPages}</span>
                )}
            </div>

            {/* Question cards */}
            {questions.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                    <p className="text-lg font-medium">All questions on this page verified!</p>
                    {currentPage < totalPages && (
                        <Link href={buildPageUrl(currentPage + 1)} className="mt-4 inline-block px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
                            Next Page →
                        </Link>
                    )}
                </div>
            ) : (
                questions.map(q => (
                    <QuestionCard key={q.id} question={q} onVerified={handleVerified} />
                ))
            )}

            {/* Pagination */}
            {totalPages > 1 && questions.length > 0 && (
                <div className="flex items-center justify-between mt-8 pt-4 border-t border-gray-200">
                    <div className="text-sm text-gray-500">
                        Page <span className="font-semibold">{currentPage}</span> of <span className="font-semibold">{totalPages}</span>
                    </div>
                    <div className="flex gap-2">
                        {currentPage > 1 && (
                            <Link href={buildPageUrl(currentPage - 1)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 text-gray-700">
                                ← Previous
                            </Link>
                        )}
                        {currentPage < totalPages && (
                            <Link href={buildPageUrl(currentPage + 1)} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800">
                                Next →
                            </Link>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
