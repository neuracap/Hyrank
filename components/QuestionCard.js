'use client';

import { useState } from 'react';
import Latex from './Latex';

export default function QuestionCard({ question, onSave, onImagePaste, onAddImage }) {
    const [q, setQ] = useState(() => {
        // Ensure A, B, C, D options exist
        const REQUIRED_OPTS = ['A', 'B', 'C', 'D'];
        const optMap = new Map((question.options || []).map(o => [o.opt_label, o]));
        const options = REQUIRED_OPTS.map(label => ({
            opt_label: label,
            opt_text: optMap.get(label)?.opt_text || '',
            id: optMap.get(label)?.id || null
        }));
        return { ...question, options };
    });
    const [isSaving, setIsSaving] = useState(false);
    const [feedbackMessage, setFeedbackMessage] = useState(null);
    const [savedStatus, setSavedStatus] = useState(
        question.is_manually_corrected ? 'MANUALLY_CORRECTED' : null
    );

    const handleSave = async (status = 'MANUALLY_CORRECTED') => {
        setIsSaving(true);
        try {
            await onSave({ ...q, saveStatus: status });
            setSavedStatus(status);
            setFeedbackMessage(status === 'FLAGGED' ? 'Marked for Review!' : 'Saved!');
            setTimeout(() => setFeedbackMessage(null), 1500);
        } catch (error) {
            console.error(error);
            alert('Failed to save question');
        } finally {
            setIsSaving(false);
        }
    };

    const handleTextChange = (value) => {
        setQ(prev => ({ ...prev, question_text: value }));
    };

    const handleOptionChange = (optIdx, value) => {
        setQ(prev => {
            const newOptions = [...prev.options];
            newOptions[optIdx] = { ...newOptions[optIdx], opt_text: value };
            return { ...prev, options: newOptions };
        });
    };

    const handlePaste = (e, optIndex = null) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (onImagePaste) {
                    onImagePaste(blob, question, optIndex, (imageTag) => {
                        // Auto-insert the image tag into the correct field
                        if (optIndex !== null) {
                            handleOptionChange(optIndex, (q.options[optIndex]?.opt_text || '') + ` ${imageTag}`);
                        } else {
                            handleTextChange((q.question_text || '') + `\n\n${imageTag}`);
                        }
                    });
                }
                break;
            }
        }
    };

    const handleUnderline = (textType, optIndex = null) => {
        const textareaId = textType === 'question'
            ? `question-text-${question.id}`
            : `option-text-${question.id}-${optIndex}`;
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
            handleTextChange(newValue);
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

    // Validation & Heuristics
    const isCorrected = savedStatus === 'MANUALLY_CORRECTED';
    const isFlagged = savedStatus === 'FLAGGED';

    const warnings = [];

    // 1. Blank/empty options
    const blankOpts = q.options.filter(o => !o.opt_text || !o.opt_text.trim());
    if (blankOpts.length > 0) {
        warnings.push(`Blank option(s): ${blankOpts.map(o => o.opt_label).join(', ')}`);
    }

    // 2. Gibberish / forbidden phrases in question or options
    const forbiddenPhrases = ['Question ID', 'Question ID:', 'Status', 'Click Here', 'Challenge', 'Question No.', 'https://', 'Not provided in the source', 'Not Available'];
    const hasForbidden = (text) => text && forbiddenPhrases.some(p => text.includes(p));
    const textHasForbidden = hasForbidden(q.question_text);
    if (textHasForbidden) warnings.push('Question text contains suspicious text (Question ID, Status, etc.)');
    const forbiddenOpts = q.options.filter(o => hasForbidden(o.opt_text));
    if (forbiddenOpts.length > 0) warnings.push(`Option(s) ${forbiddenOpts.map(o => o.opt_label).join(', ')} contain suspicious text`);

    // 3. Probable missing image — keywords suggesting a figure should be present but no image tag found
    const hasImageTag = (text) => /\\includegraphics|!\[.*?\]\(.*?\)|\.jpg|\.png|\.jpeg|\.gif|\.svg/.test(text || '');
    const imageKeywords = /\b(mirror|image|figure|diagram|picture|graph|table|chart|map|given below|shown below|refer to|as shown|adjacent figure)\b/i;
    const questionHasImageKeyword = imageKeywords.test(q.question_text || '');
    const questionHasImage = hasImageTag(q.question_text) || q.options.some(o => hasImageTag(o.opt_text));
    if (questionHasImageKeyword && !questionHasImage) {
        warnings.push('Possible missing image (text mentions figure/image/diagram but none found)');
    }

    // 4. Image file references in text (likely raw .jpg/.png paths that weren't converted)
    const rawImageRef = /\.(jpg|jpeg|png|gif|svg)\b/i;
    if (rawImageRef.test(q.question_text || '')) warnings.push('Question text contains raw image file reference (.jpg/.png)');
    const imgRefOpts = q.options.filter(o => rawImageRef.test(o.opt_text || ''));
    if (imgRefOpts.length > 0) warnings.push(`Option(s) ${imgRefOpts.map(o => o.opt_label).join(', ')} contain raw image file reference`);

    const hasWarnings = warnings.length > 0;

    let borderClass = 'border-gray-200';
    let bgClass = 'bg-white';
    if (isFlagged) {
        borderClass = 'border-orange-300 ring-1 ring-orange-100';
        bgClass = 'bg-orange-50/30';
    } else if (hasWarnings && !isCorrected) {
        borderClass = 'border-pink-400 ring-2 ring-pink-100';
        bgClass = 'bg-pink-50';
    } else if (!isCorrected) {
        borderClass = 'border-amber-300 ring-1 ring-amber-100';
        bgClass = 'bg-amber-50/30';
    }

    return (
        <div
            id={`q-${question.id}`}
            className={`scroll-mt-20 rounded-lg border shadow-sm overflow-hidden transition-all duration-200 ${borderClass} ${bgClass}`}
        >
            {/* Top Bar */}
            <div className="px-6 py-3 border-b flex justify-between items-center bg-gray-50/50 border-gray-200">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-0.5 text-sm font-bold text-gray-800 font-mono">
                        <span>Q.</span>
                        <input
                            type="text"
                            className="w-12 px-1 py-0.5 text-sm font-bold font-mono text-gray-800 border border-transparent hover:border-gray-300 focus:border-blue-400 focus:ring-1 focus:ring-blue-300 rounded bg-transparent text-center"
                            value={q.source_q_no ? q.source_q_no.replace(/Q\.\s*/, '').trim() : (q.q_no || '')}
                            onChange={(e) => setQ(prev => ({ ...prev, source_q_no: e.target.value }))}
                            onKeyDown={handleKeyDown}
                            title="Edit question number"
                        />
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${q.language === 'EN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}`}>
                        {q.language}
                    </span>
                    {q.subject && (
                        <span className="text-xs text-gray-400 font-medium">{q.subject}</span>
                    )}
                    <span className="text-[10px] text-gray-300 font-mono select-all">{question.id}</span>
                </div>
                <div className="flex gap-2 items-center">
                    {feedbackMessage && (
                        <span className="font-bold text-green-600 bg-green-50 px-2 py-1 rounded text-xs border border-green-200 shadow-sm">
                            {feedbackMessage}
                        </span>
                    )}
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        isCorrected ? 'bg-green-100 text-green-700' :
                        isFlagged ? 'bg-orange-100 text-orange-700' :
                        'bg-amber-100 text-amber-700'
                    }`}>
                        {isCorrected ? 'MANUALLY_CORRECTED' : isFlagged ? 'FLAGGED' : 'Unreviewed'}
                    </span>
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
                        {isSaving ? 'Saving...' : 'Save Changes'}
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
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleUnderline('question')}
                                className="px-2 py-1 text-xs font-bold bg-blue-500 text-white rounded hover:bg-blue-600 shadow-sm"
                                title="Underline selected text"
                            >
                                U
                            </button>
                            {onAddImage && (
                                <button
                                    type="button"
                                    onClick={() => onAddImage(question)}
                                    className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium bg-blue-50 border border-blue-200 px-2 py-1 rounded"
                                >
                                    Add Image
                                </button>
                            )}
                        </div>
                    </div>
                    <textarea
                        id={`question-text-${question.id}`}
                        className={`w-full p-3 border rounded font-mono text-sm min-h-[120px] mb-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y ${textHasForbidden ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                        value={q.question_text || ''}
                        onChange={(e) => handleTextChange(e.target.value)}
                        onPaste={(e) => handlePaste(e)}
                        onKeyDown={handleKeyDown}
                        placeholder="Enter question text..."
                    />
                    <div className="p-3 bg-gray-50 rounded border border-gray-200 text-sm">
                        <p className="text-xs font-bold text-gray-400 uppercase mb-1">Preview</p>
                        <Latex>{q.question_text || ''}</Latex>
                    </div>
                </div>

                {/* Options */}
                <div className="space-y-4">
                    {q.options.map((opt, optIdx) => (
                        <div key={opt.opt_label} className="p-2 border border-gray-100 rounded bg-gray-50/50">
                            <div className="flex gap-2 items-center mb-2">
                                <div className="w-6 h-6 flex items-center justify-center rounded-full bg-white border border-gray-300 text-xs font-bold text-gray-500 shrink-0">
                                    {opt.opt_label}
                                </div>
                                <input
                                    id={`option-text-${question.id}-${optIdx}`}
                                    className={`flex-1 text-xs p-1.5 border rounded font-mono ${hasForbidden(opt.opt_text) ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                                    value={opt.opt_text || ''}
                                    onChange={(e) => handleOptionChange(optIdx, e.target.value)}
                                    onPaste={(e) => handlePaste(e, optIdx)}
                                    onKeyDown={handleKeyDown}
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
