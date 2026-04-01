'use client';

import { useState, useEffect } from 'react';
import BilingualList from '@/components/BilingualList';
import Latex from '@/components/Latex';

// ─── Solo Flagged Card (mirrors VerifyUnlink's VerifyCard) ───

function SoloFlaggedCard({ question, onCorrected }) {
    const REQUIRED_OPTS = ['A', 'B', 'C', 'D'];
    const optMap = new Map((question.options || []).map(o => [o.opt_label, o]));
    const initialOptions = REQUIRED_OPTS.map(label => ({
        opt_label: label,
        opt_text: optMap.get(label)?.opt_text || ''
    }));

    const [questionText, setQuestionText] = useState(question.question_text || '');
    const [options, setOptions] = useState(initialOptions);
    const [isSaving, setIsSaving] = useState(false);
    const [corrected, setCorrected] = useState(false);
    const [feedbackMessage, setFeedbackMessage] = useState(null);
    const [savedStatus, setSavedStatus] = useState(null);

    const handleSave = async (status = 'MANUALLY_CORRECTED') => {
        setIsSaving(true);
        try {
            const res = await fetch('/api/verify-unlink/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: question.question_id,
                    version_no: question.version_no,
                    language: question.language,
                    question_text: questionText,
                    options: options,
                    status: status,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setSavedStatus(status);
                setFeedbackMessage(status === 'FLAGGED' ? 'Kept Flagged!' : 'Saved & Corrected!');
                if (status === 'MANUALLY_CORRECTED') {
                    setTimeout(() => {
                        setCorrected(true);
                        onCorrected(question.question_id);
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
            ? `sf-question-${question.question_id}`
            : `sf-opt-${question.question_id}-${optIndex}`;
        const textarea = document.getElementById(textareaId);
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end);

        if (!selectedText) { alert('Please select some text first'); return; }

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

    // Image paste upload
    const performUpload = async (fileBlob, optIndex = null) => {
        const role = optIndex !== null ? 'option' : 'stem';
        const optionKey = optIndex !== null ? ['A', 'B', 'C', 'D'][optIndex] : '__STEM__';

        const reader = new FileReader();
        reader.readAsDataURL(fileBlob);
        reader.onloadend = async () => {
            try {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: reader.result,
                        question_id: question.question_id,
                        language: question.language,
                        version_no: question.version_no,
                        role: role,
                        option_key: optionKey,
                    }),
                });
                const data = await res.json();
                if (data.latexPath) {
                    const imageTag = `\\includegraphics{${data.latexPath}}`;
                    if (optIndex !== null) {
                        handleOptionChange(optIndex, (options[optIndex].opt_text || '') + ` ${imageTag}`);
                    } else {
                        setQuestionText(prev => prev + `\n\n${imageTag}`);
                    }
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

    if (corrected) return null;

    // Warnings
    const warnings = [];
    const blankOpts = options.filter(o => !o.opt_text || !o.opt_text.trim());
    if (blankOpts.length > 0) warnings.push(`Blank option(s): ${blankOpts.map(o => o.opt_label).join(', ')}`);

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

    let borderClass = 'border-red-300 ring-1 ring-red-100';
    let bgClass = 'bg-red-50/30';
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
                        Q.{question.source_question_no || question.question_id?.substring(0, 6)}
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
                        <a href={`/api/pdf?path=${encodeURIComponent(question.source_pdf_path)}`} target="_blank" rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-0.5 rounded text-xs shadow-sm">
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
                    <button onClick={() => handleSave('FLAGGED')} disabled={isSaving}
                        className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors shadow-sm disabled:opacity-50"
                        title="Keep flagged for further review">
                        Keep Flagged
                    </button>
                    <button onClick={() => handleSave('MANUALLY_CORRECTED')} disabled={isSaving}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors shadow-sm disabled:opacity-50">
                        {isSaving ? 'Saving...' : 'Save & Correct'}
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
                        <button onClick={() => handleUnderline('question')}
                            className="px-2 py-1 text-xs font-bold bg-blue-500 text-white rounded hover:bg-blue-600 shadow-sm"
                            title="Underline selected text">
                            U
                        </button>
                    </div>
                    <textarea
                        id={`sf-question-${question.question_id}`}
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
                                    id={`sf-opt-${question.question_id}-${optIdx}`}
                                    className={`flex-1 text-xs p-1.5 border rounded font-mono ${hasForbidden(opt.opt_text) ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                                    value={opt.opt_text || ''}
                                    onChange={(e) => handleOptionChange(optIdx, e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    onPaste={(e) => handlePaste(e, optIdx)}
                                    placeholder={`Option ${opt.opt_label}...`}
                                />
                                <button onClick={() => handleUnderline('option', optIdx)}
                                    className="px-2 py-1 text-xs font-bold bg-blue-500 text-white rounded hover:bg-blue-600 shadow-sm shrink-0"
                                    title="Underline selected text">
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

// ─── Solo Flagged List ───

function SoloFlaggedList({ questions: initialQuestions }) {
    const [questions, setQuestions] = useState(initialQuestions);
    const [remaining, setRemaining] = useState(initialQuestions.length);

    useEffect(() => {
        setQuestions(initialQuestions);
        setRemaining(initialQuestions.length);
    }, [initialQuestions]);

    const handleCorrected = (questionId) => {
        setQuestions(prev => prev.filter(q => q.question_id !== questionId));
        setRemaining(prev => prev - 1);
    };

    if (initialQuestions.length === 0) {
        return <div className="text-center py-16 text-gray-400">No solo flagged questions found.</div>;
    }

    return (
        <div>
            <div className="mb-4 text-sm text-gray-500">
                <span className="font-semibold text-gray-800">{remaining}</span> question{remaining !== 1 ? 's' : ''} remaining
            </div>
            {questions.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                    <p className="text-lg font-medium">All solo flagged questions corrected!</p>
                </div>
            ) : (
                questions.map(q => (
                    <SoloFlaggedCard key={`${q.question_id}_${q.version_no}`} question={q} onCorrected={handleCorrected} />
                ))
            )}
        </div>
    );
}

// ─── Tabs Wrapper ───

export default function FlaggedTabs({ linkedQuestions, linkedTotal, linkedPage, linkedTotalPages, soloQuestions, soloTotal }) {
    const [tab, setTab] = useState('reviewed');

    // Split linked questions by paper status
    const REVIEWED_STATUSES = ['TEAM_REVIEWED', 'ADMIN_REVIEWED', 'MISSING_ADDED', 'PRE_PUBLISH_READY', 'SOLUTION_REVIEW', 'PRODUCTION'];
    const activeLinked = linkedQuestions.filter(q => q.paper_status !== 'NOT_WORTHY');
    const notWorthyLinked = linkedQuestions.filter(q => q.paper_status === 'NOT_WORTHY');
    const reviewedLinked = activeLinked.filter(q => REVIEWED_STATUSES.includes(q.paper_status));
    const unreviewedLinked = activeLinked.filter(q => !REVIEWED_STATUSES.includes(q.paper_status));

    return (
        <>
            <header className="mb-6 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Flagged Questions</h1>
                <p className="text-sm text-gray-500 mb-4">
                    Questions marked for review across the platform. Edit and save to mark them as corrected.
                </p>
                <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setTab('reviewed')}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === 'reviewed' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        Reviewed Papers ({reviewedLinked.length})
                    </button>
                    <button onClick={() => setTab('unreviewed')}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === 'unreviewed' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        Unreviewed Papers ({unreviewedLinked.length})
                    </button>
                    <button onClick={() => setTab('all')}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === 'all' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        All Linked ({activeLinked.length})
                    </button>
                    <button onClick={() => setTab('solo')}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === 'solo' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        Solo ({soloTotal})
                    </button>
                    {notWorthyLinked.length > 0 && (
                        <button onClick={() => setTab('not_worthy')}
                            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === 'not_worthy' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                            Not Worthy ({notWorthyLinked.length})
                        </button>
                    )}
                </div>
                {tab === 'reviewed' && (
                    <p className="text-xs text-red-600 font-semibold mt-2">
                        Critical: These are from TEAM_REVIEWED / ADMIN_REVIEWED / MISSING_ADDED papers — resolve first for solutions pipeline.
                    </p>
                )}
            </header>

            {tab === 'reviewed' ? (
                <BilingualList
                    initialQuestions={reviewedLinked}
                    total={reviewedLinked.length}
                    currentPage={1}
                    totalPages={1}
                    isReviewMode={false}
                    isGlobalFlaggedMode={true}
                    paperSessionId="FLAGGED_REVIEWED"
                />
            ) : tab === 'unreviewed' ? (
                <BilingualList
                    initialQuestions={unreviewedLinked}
                    total={unreviewedLinked.length}
                    currentPage={1}
                    totalPages={1}
                    isReviewMode={false}
                    isGlobalFlaggedMode={true}
                    paperSessionId="FLAGGED_UNREVIEWED"
                />
            ) : tab === 'all' ? (
                <BilingualList
                    initialQuestions={activeLinked}
                    total={activeLinked.length}
                    currentPage={1}
                    totalPages={1}
                    isReviewMode={false}
                    isGlobalFlaggedMode={true}
                    paperSessionId="FLAGGED_GLOBAL"
                />
            ) : tab === 'not_worthy' ? (
                <BilingualList
                    initialQuestions={notWorthyLinked}
                    total={notWorthyLinked.length}
                    currentPage={1}
                    totalPages={1}
                    isReviewMode={false}
                    isGlobalFlaggedMode={true}
                    paperSessionId="FLAGGED_NOT_WORTHY"
                />
            ) : (
                <SoloFlaggedList questions={soloQuestions} />
            )}
        </>
    );
}
