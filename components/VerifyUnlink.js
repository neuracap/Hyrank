'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Latex from './Latex';

function VerifyCard({ question, onVerified }) {
    const REQUIRED_OPTS = ['A', 'B', 'C', 'D'];
    const optMap = new Map((question.options || []).map(o => [o.opt_label, o]));
    const initialOptions = REQUIRED_OPTS.map(label => ({
        opt_label: label,
        opt_text: optMap.get(label)?.opt_text || ''
    }));

    const [questionText, setQuestionText] = useState(question.question_text || '');
    const [options, setOptions] = useState(initialOptions);
    const [isSaving, setIsSaving] = useState(false);
    const [verified, setVerified] = useState(false);
    const [feedbackMessage, setFeedbackMessage] = useState(null);
    const [savedStatus, setSavedStatus] = useState(null);

    const handleSave = async (status = 'MANUALLY_CORRECTED') => {
        setIsSaving(true);
        try {
            const res = await fetch('/api/verify-unlink/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: question.id,
                    version_no: question.version_no,
                    language: question.language,
                    question_text: questionText,
                    options: options,
                    status: status
                })
            });
            const data = await res.json();
            if (data.success) {
                setSavedStatus(status);
                setFeedbackMessage(status === 'FLAGGED' ? 'Marked for Review!' : 'Saved & Verified!');
                if (status === 'MANUALLY_CORRECTED') {
                    // Remove from list after a short delay so user sees the feedback
                    setTimeout(() => {
                        setVerified(true);
                        onVerified(question.id);
                    }, 800);
                } else {
                    setTimeout(() => setFeedbackMessage(null), 1500);
                }
            } else {
                alert('Save failed: ' + data.error);
            }
        } catch (e) {
            alert('Error saving: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleOptionChange = (optIdx, value) => {
        setOptions(prev => {
            const newOpts = [...prev];
            newOpts[optIdx] = { ...newOpts[optIdx], opt_text: value };
            return newOpts;
        });
    };

    const handleUnderline = (textType, optIndex = null) => {
        const textareaId = textType === 'question'
            ? `vu-question-${question.id}`
            : `vu-opt-${question.id}-${optIndex}`;
        const textarea = document.getElementById(textareaId);
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end);

        if (!selectedText) {
            alert('Please select some text first');
            return;
        }

        const wrappedText = `$\\underline{\\text{${selectedText}}}$`;
        const newValue = textarea.value.substring(0, start) + wrappedText + textarea.value.substring(end);

        if (textType === 'question') {
            setQuestionText(newValue);
        } else {
            handleOptionChange(optIndex, newValue);
        }

        setTimeout(() => {
            textarea.focus();
            const newCursorPos = start + wrappedText.length;
            textarea.setSelectionRange(newCursorPos, newCursorPos);
        }, 0);
    };

    const handleKeyDown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            handleSave('MANUALLY_CORRECTED');
        }
    };

    // Image paste upload (same pattern as BilingualList)
    const performUpload = async (fileBlob, optIndex = null) => {
        const role = optIndex !== null ? 'option' : 'stem';
        const optionKey = optIndex !== null ? ['A', 'B', 'C', 'D'][optIndex] : '__STEM__';

        const reader = new FileReader();
        reader.readAsDataURL(fileBlob);
        reader.onloadend = async () => {
            const base64data = reader.result;
            try {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: base64data,
                        question_id: question.id,
                        language: question.language,
                        version_no: question.version_no,
                        role: role,
                        option_key: optionKey
                    })
                });
                const data = await res.json();
                if (data.latexPath) {
                    insertImageTag(data.latexPath, optIndex);
                } else {
                    alert('Upload failed: ' + (data.error || 'Unknown error'));
                }
            } catch (e) {
                console.error('Image upload error:', e);
                alert('Upload failed');
            }
        };
    };

    const handlePaste = (e, optIndex = null) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (let item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                performUpload(item.getAsFile(), optIndex);
                break;
            }
        }
    };

    const insertImageTag = (path, optIndex = null) => {
        const imageTag = `\\includegraphics{${path}}`;
        if (optIndex !== null) {
            handleOptionChange(optIndex, (options[optIndex].opt_text || '') + ` ${imageTag}`);
        } else {
            setQuestionText(prev => prev + `\n\n${imageTag}`);
        }
    };

    if (verified) return null;

    // Heuristic warnings
    const warnings = [];

    const blankOpts = options.filter(o => !o.opt_text || !o.opt_text.trim());
    if (blankOpts.length > 0) {
        warnings.push(`Blank option(s): ${blankOpts.map(o => o.opt_label).join(', ')}`);
    }

    const forbiddenPhrases = ['Question ID', 'Question ID:', 'Status', 'Click Here', 'Challenge', 'Question No.', 'https://', 'Not provided in the source', 'Not Available'];
    const hasForbidden = (text) => text && forbiddenPhrases.some(p => text.includes(p));
    if (hasForbidden(questionText)) warnings.push('Question text contains suspicious text');
    const forbiddenOpts = options.filter(o => hasForbidden(o.opt_text));
    if (forbiddenOpts.length > 0) warnings.push(`Option(s) ${forbiddenOpts.map(o => o.opt_label).join(', ')} contain suspicious text`);

    const hasImageTag = (text) => /\\includegraphics|!\[.*?\]\(.*?\)|\.jpg|\.png|\.jpeg|\.gif|\.svg/.test(text || '');
    const imageKeywords = /\b(mirror|image|figure|diagram|picture|graph|table|chart|map|given below|shown below|refer to|as shown|adjacent figure)\b/i;
    if (imageKeywords.test(questionText) && !hasImageTag(questionText) && !options.some(o => hasImageTag(o.opt_text))) {
        warnings.push('Possible missing image (text mentions figure/image/diagram but none found)');
    }

    const rawImageRef = /\.(jpg|jpeg|png|gif|svg)\b/i;
    if (rawImageRef.test(questionText)) warnings.push('Question text contains raw image file reference');
    const imgRefOpts = options.filter(o => rawImageRef.test(o.opt_text || ''));
    if (imgRefOpts.length > 0) warnings.push(`Option(s) ${imgRefOpts.map(o => o.opt_label).join(', ')} contain raw image file reference`);

    const hasWarnings = warnings.length > 0;
    const isFlagged = savedStatus === 'FLAGGED';

    let borderClass = 'border-gray-200';
    let bgClass = 'bg-white';
    if (isFlagged) {
        borderClass = 'border-orange-300 ring-1 ring-orange-100';
        bgClass = 'bg-orange-50/30';
    } else if (hasWarnings) {
        borderClass = 'border-pink-400 ring-2 ring-pink-100';
        bgClass = 'bg-pink-50';
    }

    return (
        <div className={`rounded-lg border shadow-sm overflow-hidden transition-all duration-200 mb-4 ${borderClass} ${bgClass}`}>
            {/* Top Bar */}
            <div className="px-6 py-3 border-b flex justify-between items-center bg-gray-50/50 border-gray-200">
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-bold text-gray-800 font-mono">
                        Q.{question.source_question_no || question.id?.substring(0, 6)}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${question.language === 'EN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}`}>
                        {question.language}
                    </span>
                    <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full">
                        {question.session_label || question.paper_session_id}
                    </span>
                    {question.exam_name && (
                        <span className="text-xs text-gray-400">{question.exam_name}</span>
                    )}
                    {question.source_pdf_path && (
                        <a
                            href={`/api/pdf?path=${encodeURIComponent(question.source_pdf_path)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-0.5 rounded text-xs shadow-sm"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-gray-500">
                                <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" />
                                <path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" />
                            </svg>
                            PDF
                        </a>
                    )}
                </div>
                <div className="flex gap-2 items-center">
                    {feedbackMessage && (
                        <span className="font-bold text-green-600 bg-green-50 px-2 py-1 rounded text-xs border border-green-200 shadow-sm">
                            {feedbackMessage}
                        </span>
                    )}
                    {savedStatus && (
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            savedStatus === 'MANUALLY_CORRECTED' ? 'bg-green-100 text-green-700' :
                            savedStatus === 'FLAGGED' ? 'bg-orange-100 text-orange-700' : ''
                        }`}>
                            {savedStatus}
                        </span>
                    )}
                    <button
                        onClick={() => handleSave('FLAGGED')}
                        disabled={isSaving}
                        className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors shadow-sm disabled:opacity-50"
                        title="Mark question for further review"
                    >
                        Mark for Review
                    </button>
                    <button
                        onClick={() => handleSave('MANUALLY_CORRECTED')}
                        disabled={isSaving}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors shadow-sm disabled:opacity-50"
                    >
                        {isSaving ? 'Saving...' : 'Save & Verify'}
                    </button>
                </div>
            </div>

            {/* Warning Banner */}
            {hasWarnings && (
                <div className="px-6 py-2 text-xs font-bold bg-pink-100 text-pink-800 border-b border-pink-200">
                    {warnings.map((w, i) => <div key={i} className="flex items-center gap-2">&#x26A0;&#xFE0F; {w}</div>)}
                </div>
            )}

            {/* Question Body */}
            <div className="p-6">
                {/* Question Text */}
                <div className="mb-6">
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Question Text</label>
                        <button
                            onClick={() => handleUnderline('question')}
                            className="px-2 py-1 text-xs font-bold bg-blue-500 text-white rounded hover:bg-blue-600 shadow-sm"
                            title="Underline selected text"
                        >
                            U
                        </button>
                    </div>
                    <textarea
                        id={`vu-question-${question.id}`}
                        className={`w-full p-3 border rounded font-mono text-sm min-h-[120px] mb-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y ${hasForbidden(questionText) ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                        value={questionText}
                        onChange={(e) => setQuestionText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onPaste={(e) => handlePaste(e)}
                        placeholder="Enter question text..."
                    />
                    <div className="p-3 bg-gray-50 rounded border border-gray-200 text-sm">
                        <p className="text-xs font-bold text-gray-400 uppercase mb-1">Preview</p>
                        <Latex>{questionText}</Latex>
                    </div>
                </div>

                {/* Options */}
                <div className="space-y-4">
                    {options.map((opt, optIdx) => (
                        <div key={opt.opt_label} className="p-2 border border-gray-100 rounded bg-gray-50/50">
                            <div className="flex gap-2 items-center mb-2">
                                <div className="w-6 h-6 flex items-center justify-center rounded-full bg-white border border-gray-300 text-xs font-bold text-gray-500 shrink-0">
                                    {opt.opt_label}
                                </div>
                                <input
                                    id={`vu-opt-${question.id}-${optIdx}`}
                                    className={`flex-1 text-xs p-1.5 border rounded font-mono ${hasForbidden(opt.opt_text) ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                                    value={opt.opt_text || ''}
                                    onChange={(e) => handleOptionChange(optIdx, e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    onPaste={(e) => handlePaste(e, optIdx)}
                                    placeholder={`Option ${opt.opt_label}...`}
                                />
                                <button
                                    onClick={() => handleUnderline('option', optIdx)}
                                    className="px-2 py-1 text-xs font-bold bg-blue-500 text-white rounded hover:bg-blue-600 shadow-sm shrink-0"
                                    title="Underline selected text"
                                >
                                    U
                                </button>
                            </div>
                            <div className="pl-8 text-xs text-gray-700">
                                <Latex>{opt.opt_text || ''}</Latex>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function VerifyUnlink({ initialQuestions, total, currentPage, totalPages }) {
    const [questions, setQuestions] = useState(initialQuestions);
    const [remaining, setRemaining] = useState(total);

    useEffect(() => {
        setQuestions(initialQuestions);
        setRemaining(total);
    }, [initialQuestions, total]);

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
                            Next Page
                        </Link>
                    )}
                </div>
            ) : (
                questions.map(q => (
                    <VerifyCard key={q.id} question={q} onVerified={handleVerified} />
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
                                Previous
                            </Link>
                        )}
                        {currentPage < totalPages && (
                            <Link href={buildPageUrl(currentPage + 1)} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800">
                                Next
                            </Link>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
