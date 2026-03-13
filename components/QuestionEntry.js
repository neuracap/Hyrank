'use client';

import { useState, useEffect } from 'react';
import Latex from './Latex';

const EMPTY_LANG = { text: '', options: { A: '', B: '', C: '', D: '' } };
const OPTION_KEYS = ['A', 'B', 'C', 'D'];

function LanguagePanel({ lang, label, color, data, onChange, correctAnswer, onCorrectChange, questionId, onImageUpload, uploading }) {
    const badgeColor = color === 'blue' ? 'bg-blue-600' : 'bg-orange-600';
    const ringColor = color === 'blue' ? 'focus:ring-blue-500 focus:border-blue-500' : 'focus:ring-orange-500 focus:border-orange-500';

    const handlePaste = (e, optKey = null) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                onImageUpload(blob, lang, optKey);
                break;
            }
        }
    };

    const handleUnderline = (textType, optKey = null) => {
        const textareaId = textType === 'question'
            ? `qe-question-${lang}-${questionId}`
            : `qe-opt-${lang}-${optKey}-${questionId}`;
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
            onChange('text', newValue);
        } else {
            onChange('option', newValue, optKey);
        }

        setTimeout(() => {
            textarea.focus();
            const newCursorPos = start + wrappedText.length;
            textarea.setSelectionRange(newCursorPos, newCursorPos);
        }, 0);
    };

    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-4">
                <span className={`${badgeColor} text-white text-xs font-bold px-2 py-0.5 rounded`}>{lang.toUpperCase()}</span>
                <h3 className="font-bold text-gray-700">{label}</h3>
            </div>

            {/* Question Text */}
            <div className="mb-4">
                <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-gray-500 uppercase">Question Text</label>
                    <button
                        type="button"
                        onClick={() => handleUnderline('question')}
                        className="px-2 py-0.5 text-xs font-bold bg-blue-500 text-white rounded hover:bg-blue-600 shadow-sm"
                        title="Underline selected text"
                    >
                        U
                    </button>
                </div>
                <textarea
                    id={`qe-question-${lang}-${questionId}`}
                    className={`w-full p-3 border border-gray-300 rounded font-mono text-sm min-h-[100px] mb-2 ${ringColor} resize-y`}
                    value={data.text}
                    onChange={(e) => onChange('text', e.target.value)}
                    onPaste={(e) => handlePaste(e)}
                    placeholder={lang === 'EN' ? 'Enter English question text... (paste images with Ctrl+V)' : 'हिंदी प्रश्न यहाँ दर्ज करें... (Ctrl+V से चित्र पेस्ट करें)'}
                />
                {uploading && <p className="text-xs text-blue-500 font-medium mb-1">Uploading image...</p>}
                <div className="p-3 bg-gray-50 rounded border border-gray-200 text-sm">
                    <p className="text-xs font-bold text-gray-400 uppercase mb-1">Preview</p>
                    <Latex>{data.text || ''}</Latex>
                </div>
            </div>

            {/* Options */}
            <div className="space-y-3">
                {OPTION_KEYS.map(key => (
                    <div key={key} className="p-2 border border-gray-100 rounded bg-gray-50/50">
                        <div className="flex gap-2 items-center mb-1">
                            <label className="flex items-center gap-1 shrink-0 cursor-pointer" title={`Mark ${key} as correct`}>
                                <input
                                    type="radio"
                                    name={`correct-${questionId}`}
                                    checked={correctAnswer === key}
                                    onChange={() => onCorrectChange(key)}
                                    className="w-4 h-4 text-green-600 border-gray-300 focus:ring-green-500"
                                />
                                <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold shrink-0 ${correctAnswer === key
                                    ? 'bg-green-100 text-green-700 border border-green-300'
                                    : 'bg-white border border-gray-300 text-gray-500'
                                    }`}>
                                    {key}
                                </span>
                            </label>
                            <input
                                id={`qe-opt-${lang}-${key}-${questionId}`}
                                className={`flex-1 text-xs p-1.5 border border-gray-300 rounded font-mono ${ringColor}`}
                                value={data.options[key] || ''}
                                onChange={(e) => onChange('option', e.target.value, key)}
                                onPaste={(e) => handlePaste(e, key)}
                                placeholder={lang === 'EN' ? `Option ${key}...` : `विकल्प ${key}...`}
                            />
                            <button
                                type="button"
                                onClick={() => handleUnderline('option', key)}
                                className="px-2 py-1 text-xs font-bold bg-blue-500 text-white rounded hover:bg-blue-600 shadow-sm shrink-0"
                                title="Underline selected text"
                            >
                                U
                            </button>
                        </div>
                        <div className="pl-8 text-xs text-gray-700">
                            <Latex>{data.options[key] || ''}</Latex>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function QuestionEntry() {
    const [exams, setExams] = useState([]);
    const [loading, setLoading] = useState(true);

    // Selections
    const [selectedExamId, setSelectedExamId] = useState('');
    const [selectedSectionId, setSelectedSectionId] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [sourceQNo, setSourceQNo] = useState('');
    const [correctAnswer, setCorrectAnswer] = useState('');

    // Question data
    const [english, setEnglish] = useState({ ...EMPTY_LANG, options: { ...EMPTY_LANG.options } });
    const [hindi, setHindi] = useState({ ...EMPTY_LANG, options: { ...EMPTY_LANG.options } });

    // UI state
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState(null);
    const [savedCount, setSavedCount] = useState(0);
    const [questionId, setQuestionId] = useState(0); // for unique element IDs

    // Fetch exams on mount
    useEffect(() => {
        fetch('/api/exams')
            .then(r => r.json())
            .then(data => {
                setExams(data.exams || []);
                setLoading(false);
            })
            .catch(e => {
                console.error(e);
                setLoading(false);
            });
    }, []);

    const selectedExam = exams.find(e => e.exam_id === selectedExamId);
    const sections = selectedExam?.sections || [];

    const handleEnglishChange = (type, value, optKey) => {
        if (type === 'text') {
            setEnglish(prev => ({ ...prev, text: value }));
        } else {
            setEnglish(prev => ({ ...prev, options: { ...prev.options, [optKey]: value } }));
        }
    };

    const handleHindiChange = (type, value, optKey) => {
        if (type === 'text') {
            setHindi(prev => ({ ...prev, text: value }));
        } else {
            setHindi(prev => ({ ...prev, options: { ...prev.options, [optKey]: value } }));
        }
    };

    const handleImageUpload = async (blob, lang, optKey) => {
        setUploading(true);
        try {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = async () => {
                const base64data = reader.result;
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: base64data })
                });
                const data = await res.json();
                if (data.latexPath) {
                    const imageTag = `\\includegraphics{${data.latexPath}}`;
                    const setter = lang === 'EN' ? setEnglish : setHindi;
                    if (optKey) {
                        setter(prev => ({
                            ...prev,
                            options: {
                                ...prev.options,
                                [optKey]: (prev.options[optKey] || '') + ` ${imageTag}`
                            }
                        }));
                    } else {
                        setter(prev => ({
                            ...prev,
                            text: prev.text + `\n\n${imageTag}`
                        }));
                    }
                } else {
                    alert('Upload failed: ' + (data.error || 'Unknown error'));
                }
                setUploading(false);
            };
        } catch (e) {
            console.error(e);
            alert('Upload failed');
            setUploading(false);
        }
    };

    const handleKeyDown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            handleSave();
        }
    };

    const handleSave = async () => {
        if (!english.text.trim() && !hindi.text.trim()) {
            setMessage({ type: 'error', text: 'Please enter question text in at least one language' });
            return;
        }

        if (!correctAnswer) {
            setMessage({ type: 'error', text: 'Please select the correct answer' });
            return;
        }

        setSubmitting(true);
        setMessage(null);

        try {
            const res = await fetch('/api/question-entry/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    exam_section_id: selectedSectionId || null,
                    difficulty: difficulty || null,
                    source_question_no: sourceQNo || null,
                    correct_answer: correctAnswer,
                    english,
                    hindi
                })
            });

            const data = await res.json();

            if (data.success) {
                setSavedCount(prev => prev + 1);
                setMessage({ type: 'success', text: `Question ${sourceQNo || '#' + (savedCount + 1)} saved successfully!` });

                // Reset form for next question (keep exam/section/difficulty selections)
                setEnglish({ text: '', options: { A: '', B: '', C: '', D: '' } });
                setHindi({ text: '', options: { A: '', B: '', C: '', D: '' } });
                setSourceQNo('');
                setCorrectAnswer('');
                setQuestionId(prev => prev + 1);

                // Auto-increment question number
                if (sourceQNo) {
                    const num = parseInt(sourceQNo.replace(/\D/g, ''), 10);
                    if (!isNaN(num)) {
                        setSourceQNo(String(num + 1));
                    }
                }
            } else {
                setMessage({ type: 'error', text: `Error: ${data.error || 'Unknown error'}` });
            }
        } catch (err) {
            setMessage({ type: 'error', text: `Network error: ${err.message}` });
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return <div className="text-center py-16 text-gray-400">Loading exams...</div>;
    }

    return (
        <div onKeyDown={handleKeyDown}>
            {/* Header */}
            <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                    <h1 className="text-2xl font-bold text-gray-900">Question Entry</h1>
                    {savedCount > 0 && (
                        <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-bold">
                            {savedCount} question{savedCount !== 1 ? 's' : ''} saved this session
                        </span>
                    )}
                </div>
                <p className="text-sm text-gray-500">Enter new bilingual questions directly into the database.</p>
            </div>

            {/* Selection Bar */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-6">
                <div className="flex flex-wrap gap-4 items-end">
                    {/* Exam */}
                    <div className="flex flex-col gap-1 min-w-[220px]">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Exam</label>
                        <select
                            value={selectedExamId}
                            onChange={(e) => {
                                setSelectedExamId(e.target.value);
                                setSelectedSectionId('');
                            }}
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="">-- Select Exam --</option>
                            {exams.map(e => (
                                <option key={e.exam_id} value={e.exam_id}>{e.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Section */}
                    <div className="flex flex-col gap-1 min-w-[220px]">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Section</label>
                        <select
                            value={selectedSectionId}
                            onChange={(e) => setSelectedSectionId(e.target.value)}
                            disabled={!selectedExamId}
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                        >
                            <option value="">-- Select Section --</option>
                            {sections.map(s => (
                                <option key={s.section_id} value={s.section_id}>{s.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Difficulty */}
                    <div className="flex flex-col gap-1 min-w-[140px]">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Difficulty</label>
                        <select
                            value={difficulty}
                            onChange={(e) => setDifficulty(e.target.value)}
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="">-- Optional --</option>
                            <option value="Easy">Easy</option>
                            <option value="Medium">Medium</option>
                            <option value="Hard">Hard</option>
                        </select>
                    </div>

                    {/* Question Number */}
                    <div className="flex flex-col gap-1 min-w-[120px]">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Q. No.</label>
                        <input
                            type="text"
                            placeholder="e.g. 1"
                            value={sourceQNo}
                            onChange={(e) => setSourceQNo(e.target.value)}
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    {/* Correct Answer */}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Correct Answer</label>
                        <div className="flex gap-1">
                            {OPTION_KEYS.map(key => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setCorrectAnswer(key)}
                                    className={`w-9 h-9 rounded-md text-sm font-bold transition-all ${correctAnswer === key
                                        ? 'bg-green-600 text-white shadow-sm'
                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-300'
                                        }`}
                                >
                                    {key}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Toast */}
            {message && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${message.type === 'success'
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                    }`}>
                    {message.text}
                </div>
            )}

            {/* Copy Buttons */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-5 py-3 mb-4 flex gap-3 flex-wrap items-center">
                <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Quick Copy</span>
                <button
                    type="button"
                    onClick={() => setHindi(prev => ({ ...prev, text: english.text }))}
                    className="px-3 py-1 text-xs font-semibold bg-white border border-amber-300 text-amber-700 rounded hover:bg-amber-100 transition-colors"
                >
                    Copy Question to Hindi
                </button>
                <button
                    type="button"
                    onClick={() => setHindi(prev => ({ ...prev, options: { ...english.options } }))}
                    className="px-3 py-1 text-xs font-semibold bg-white border border-amber-300 text-amber-700 rounded hover:bg-amber-100 transition-colors"
                >
                    Copy Options to Hindi
                </button>
                <button
                    type="button"
                    onClick={() => setHindi({ text: english.text, options: { ...english.options } })}
                    className="px-3 py-1 text-xs font-semibold bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
                >
                    Copy All to Hindi
                </button>
            </div>

            {/* Bilingual Panels */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
                    {/* English */}
                    <div className="p-5">
                        <LanguagePanel
                            lang="EN"
                            label="English"
                            color="blue"
                            data={english}
                            onChange={handleEnglishChange}
                            correctAnswer={correctAnswer}
                            onCorrectChange={setCorrectAnswer}
                            questionId={questionId}
                            onImageUpload={handleImageUpload}
                            uploading={uploading}
                        />
                    </div>

                    {/* Hindi */}
                    <div className="p-5">
                        <LanguagePanel
                            lang="HI"
                            label="Hindi"
                            color="orange"
                            data={hindi}
                            onChange={handleHindiChange}
                            correctAnswer={correctAnswer}
                            onCorrectChange={setCorrectAnswer}
                            questionId={questionId}
                            onImageUpload={handleImageUpload}
                            uploading={uploading}
                        />
                    </div>
                </div>

                {/* Save Bar */}
                <div className="border-t border-gray-200 bg-gray-50 px-5 py-4 flex justify-between items-center">
                    <div className="text-xs text-gray-400">
                        Ctrl+S to save &middot; Questions are linked automatically
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={submitting}
                        className={`px-6 py-2.5 rounded-lg font-bold text-sm transition-all shadow ${submitting
                            ? 'bg-blue-400 text-white cursor-wait'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                    >
                        {submitting ? 'Saving...' : 'Save Question'}
                    </button>
                </div>
            </div>
        </div>
    );
}
