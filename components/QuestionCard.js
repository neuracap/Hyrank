'use client';

import { useState } from 'react';
import Latex from './Latex';

export default function QuestionCard({ question, onSave, onImagePaste, onAddImage }) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedQuestion, setEditedQuestion] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    const startEditing = () => {
        setEditedQuestion(JSON.parse(JSON.stringify(question))); // Deep copy
        setIsEditing(true);
    };

    const cancelEditing = () => {
        setEditedQuestion(null);
        setIsEditing(false);
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onSave(editedQuestion);
            setIsEditing(false);
            setEditedQuestion(null);
        } catch (error) {
            console.error(error);
            alert('Failed to save question');
        } finally {
            setIsSaving(false);
        }
    };

    const handleOptionChange = (index, field, value) => {
        const newOptions = [...editedQuestion.options];
        newOptions[index] = { ...newOptions[index], [field]: value };
        setEditedQuestion({ ...editedQuestion, options: newOptions });
    };

    const handlePaste = (e) => {
        if (!isEditing) return;
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (onImagePaste) {
                    onImagePaste(blob, question);
                }
                e.preventDefault(); // Prevent double paste
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

        // Wrap selected text with underline syntax
        const wrappedText = `$\\underline{\\text{${selectedText}}}$`;
        const newValue = textarea.value.substring(0, start) + wrappedText + textarea.value.substring(end);

        // Update the state
        if (textType === 'question') {
            setEditedQuestion({ ...editedQuestion, question_text: newValue });
        } else {
            handleOptionChange(optIndex, 'opt_text', newValue);
        }

        // Set cursor position after the inserted text
        setTimeout(() => {
            textarea.focus();
            const newCursorPos = start + wrappedText.length;
            textarea.setSelectionRange(newCursorPos, newCursorPos);
        }, 0);
    };

    const q = isEditing ? editedQuestion : question;
    const hasError = !q.options || q.options.length < 4;

    return (
        <div
            id={`q-${question.id}`}
            className={`scroll-mt-20 bg-white p-6 md:p-8 rounded-lg border shadow-[0_2px_4px_rgba(0,0,0,0.02)] relative transition-all duration-300 target:ring-2 target:ring-blue-500 target:shadow-lg ${hasError ? 'border-red-200 ring-1 ring-red-100' : 'border-gray-200'}`}
            onPaste={handlePaste}
        >
            {/* Top Right ID & Edit Button */}
            <div className="absolute top-4 right-4 flex items-center gap-3">
                <div className="text-xs text-gray-300 font-mono select-all">
                    {question.id}
                </div>
                {!isEditing && (
                    <button
                        onClick={startEditing}
                        className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded hover:bg-blue-50"
                        title="Edit Question"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Content */}
            <div className="flex items-start gap-4 mb-4">
                <div className="flex-shrink-0 mt-1 min-w-[3rem]">
                    {isEditing ? (
                        <input
                            type="text"
                            value={q.source_q_no || ''}
                            onChange={(e) => setEditedQuestion({ ...q, source_q_no: e.target.value })}
                            className="w-16 p-1 text-sm font-bold border border-gray-300 rounded text-center"
                            placeholder="Q.No"
                        />
                    ) : (
                        <div className="text-xl font-bold text-gray-900 leading-none">
                            Q.{q.source_q_no ? q.source_q_no.replace(/Q\.\s*/, '').trim() : q.q_no}
                        </div>
                    )}
                </div>

                <div className="flex-1 w-full min-w-0">
                    {/* Question Text */}
                    <div className="mb-6">
                        {isEditing ? (
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="text-xs font-semibold text-gray-500 uppercase">Question Text</label>
                                    <button
                                        type="button"
                                        onClick={() => onAddImage && onAddImage(question)}
                                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                                        </svg>
                                        Add Image
                                    </button>
                                </div>
                                <div className="relative">
                                    <textarea
                                        id={`question-text-${question.id}`}
                                        className="w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                                        rows={5}
                                        value={q.question_text}
                                        onChange={(e) => setEditedQuestion({ ...q, question_text: e.target.value })}
                                        placeholder="Enter question text here..."
                                    />
                                    <button
                                        onClick={() => handleUnderline('question')}
                                        className="absolute top-2 right-2 px-2 py-1 text-xs font-bold bg-blue-500 text-white rounded hover:bg-blue-600 shadow-sm"
                                        title="Underline selected text"
                                    >
                                        U
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-lg font-bold text-gray-900 leading-relaxed">
                                <Latex>{q.question_text}</Latex>
                            </div>
                        )}
                    </div>

                    {/* Figure Display */}
                    {q.has_figure && !isEditing && (
                        <div className="mb-8 flex justify-center bg-gray-50 p-4 rounded-lg border border-gray-100">
                            {/* Figure handling usually inside Latex or separate. Assuming existing logic handles it */}
                        </div>
                    )}

                    {/* Options */}
                    <div className="grid grid-cols-1 gap-y-3">
                        {['A', 'B', 'C', 'D'].map((label) => {
                            // Find existing option
                            const existingOpt = q.options ? q.options.find(o => o.opt_label === label) : null;
                            const idx = q.options ? q.options.indexOf(existingOpt) : -1;

                            if (existingOpt) {
                                // Render existing option editor
                                return (
                                    <div key={existingOpt.id || label} className="flex items-start gap-3 group">
                                        {/* Label */}
                                        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 font-bold text-sm border border-gray-200 mt-0.5">
                                            {isEditing ? existingOpt.opt_label : existingOpt.opt_label.toUpperCase()}
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1">
                                            {isEditing ? (
                                                <div className="relative">
                                                    <textarea
                                                        id={`option-text-${question.id}-${idx}`}
                                                        className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                                                        rows={2}
                                                        value={existingOpt.opt_text}
                                                        onChange={(e) => handleOptionChange(idx, 'opt_text', e.target.value)}
                                                    />
                                                    <button
                                                        onClick={() => handleUnderline('option', idx)}
                                                        className="absolute top-1 right-1 px-2 py-1 text-xs font-bold bg-blue-500 text-white rounded hover:bg-blue-600 shadow-sm"
                                                        title="Underline selected text"
                                                    >
                                                        U
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="text-gray-700 text-base leading-relaxed pt-1">
                                                    <Latex>{existingOpt.opt_text}</Latex>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            } else if (isEditing) {
                                // Render "Add Option" button for missing option
                                return (
                                    <div key={label} className="flex items-center gap-3">
                                        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-50 text-gray-300 font-bold text-sm border border-dashed border-gray-300 mt-0.5">
                                            {label}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const newOpt = {
                                                    id: null,
                                                    question_id: q.id,
                                                    language: q.language,
                                                    opt_label: label,
                                                    opt_text: ''
                                                };
                                                // Insert into options array
                                                const currentOptions = q.options ? [...q.options] : [];
                                                currentOptions.push(newOpt);
                                                // Sort by label just in case
                                                currentOptions.sort((a, b) => a.opt_label.localeCompare(b.opt_label));
                                                setEditedQuestion({ ...q, options: currentOptions });
                                            }}
                                            className="text-sm text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-1"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                                            </svg>
                                            Add Option {label}
                                        </button>
                                    </div>
                                );
                            } else {
                                return null; // Not editing and option doesn't exist -> hide
                            }
                        })}
                    </div>

                    {/* Edit Actions */}
                    {isEditing && (
                        <div className="mt-6 flex justify-between gap-3 pt-4 border-t border-gray-100">
                            {/* Delete Button */}
                            <button
                                onClick={() => {
                                    if (confirm('Are you sure you want to delete this question? This action cannot be undone.')) {
                                        onSave({ ...q, isDeleted: true });
                                    }
                                }}
                                className="px-3 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:text-red-700"
                                disabled={isSaving}
                            >
                                Delete
                            </button>

                            <div className="flex gap-3">
                                <button
                                    onClick={cancelEditing}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                                    disabled={isSaving}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="px-6 py-2 text-sm font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                                >
                                    {isSaving ? (
                                        <>
                                            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            Saving...
                                        </>
                                    ) : (
                                        'Save Changes'
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
