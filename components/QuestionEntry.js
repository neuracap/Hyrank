'use client';

import { useState, useEffect } from 'react';
import Latex from './Latex';

const EMPTY_LANG = { text: '', options: { A: '', B: '', C: '', D: '' } };
const OPTION_KEYS = ['A', 'B', 'C', 'D'];

function LanguagePanel({ lang, label, color, data, onChange, questionId, onImageUpload, uploading, onTranslate, translating }) {
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
                {onTranslate && (
                    <button
                        type="button"
                        onClick={onTranslate}
                        disabled={translating}
                        className="ml-auto px-3 py-1 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 transition-colors disabled:opacity-50"
                    >
                        {translating ? '...' : 'Translate'}
                    </button>
                )}
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
                            <div className="w-6 h-6 flex items-center justify-center rounded-full bg-white border border-gray-300 text-xs font-bold text-gray-500 shrink-0">
                                {key}
                            </div>
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
    const [subtype, setSubtype] = useState('');
    const [subtypes, setSubtypes] = useState([]);
    const [solutionText, setSolutionText] = useState('');
    const [isCurrentAffairs, setIsCurrentAffairs] = useState(false);
    const [caPeriod, setCaPeriod] = useState(''); // YYYY-MM format

    // Question data
    const [english, setEnglish] = useState({ ...EMPTY_LANG, options: { ...EMPTY_LANG.options } });
    const [hindi, setHindi] = useState({ ...EMPTY_LANG, options: { ...EMPTY_LANG.options } });

    // Group mode
    const [groupMode, setGroupMode] = useState(false);
    const [groupType, setGroupType] = useState('RC');
    const [passageEn, setPassageEn] = useState('');
    const [passageHi, setPassageHi] = useState('');
    const [activeGroupId, setActiveGroupId] = useState(null);
    const [groupQuestionCount, setGroupQuestionCount] = useState(0);
    const [creatingGroup, setCreatingGroup] = useState(false);
    const [translatingPassage, setTranslatingPassage] = useState(false);

    // UI state
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [translatingEng, setTranslatingEng] = useState(false);
    const [translatingHin, setTranslatingHin] = useState(false);
    const [message, setMessage] = useState(null);
    const [savedCount, setSavedCount] = useState(0);
    const [questionId, setQuestionId] = useState(0);

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

    // Fetch subtypes when section changes
    useEffect(() => {
        setSubtype('');
        if (!selectedSectionId) { setSubtypes([]); return; }
        fetch(`/api/mock-blueprint/subtypes?section_id=${selectedSectionId}`)
            .then(r => r.json())
            .then(d => setSubtypes(d.subtypes || []))
            .catch(() => setSubtypes([]));
    }, [selectedSectionId]);

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

    const handleTranslate = async (sourceLang) => {
        const sourceData = sourceLang === 'en' ? english : hindi;
        const targetLang = sourceLang === 'en' ? 'hi' : 'en';
        const setTranslating = sourceLang === 'en' ? setTranslatingHin : setTranslatingEng;
        const setTarget = sourceLang === 'en' ? setHindi : setEnglish;

        if (!sourceData.text.trim()) {
            setMessage({ type: 'error', text: 'Nothing to translate — enter text first' });
            return;
        }

        setTranslating(true);
        try {
            const textRes = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: sourceData.text, source: sourceLang, target: targetLang })
            });
            const textData = await textRes.json();

            const translatedOpts = {};
            for (const key of OPTION_KEYS) {
                if (sourceData.options[key]?.trim()) {
                    const optRes = await fetch('/api/translate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: sourceData.options[key], source: sourceLang, target: targetLang })
                    });
                    const optData = await optRes.json();
                    translatedOpts[key] = optData.translatedText || '';
                } else {
                    translatedOpts[key] = sourceData.options[key] || '';
                }
            }

            setTarget({ text: textData.translatedText || '', options: translatedOpts });
        } catch (e) {
            console.error(e);
            setMessage({ type: 'error', text: 'Translation failed: ' + e.message });
        } finally {
            setTranslating(false);
        }
    };

    const handleTranslatePassage = async () => {
        if (!passageEn.trim()) {
            setMessage({ type: 'error', text: 'Enter English passage first' });
            return;
        }
        setTranslatingPassage(true);
        try {
            const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: passageEn, source: 'en', target: 'hi' })
            });
            const data = await res.json();
            if (data.translatedText) setPassageHi(data.translatedText);
        } catch (e) {
            setMessage({ type: 'error', text: 'Passage translation failed' });
        } finally {
            setTranslatingPassage(false);
        }
    };

    const handleStartGroup = async () => {
        if (!passageEn.trim() && !passageHi.trim()) {
            setMessage({ type: 'error', text: 'Enter passage text in at least one language' });
            return;
        }
        setCreatingGroup(true);
        try {
            const res = await fetch('/api/question-group/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    group_type: groupType,
                    passage_en: passageEn,
                    passage_hi: passageHi,
                    exam_section_id: selectedSectionId || null
                })
            });
            const data = await res.json();
            if (data.success) {
                setActiveGroupId(data.group_id);
                setGroupQuestionCount(0);
                setMessage({ type: 'success', text: `${groupType} group created! Now add questions below.` });
            } else {
                setMessage({ type: 'error', text: 'Failed to create group: ' + data.error });
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Error: ' + e.message });
        } finally {
            setCreatingGroup(false);
        }
    };

    const handleFinishGroup = () => {
        setMessage({ type: 'success', text: `${groupType} group finished with ${groupQuestionCount} questions.` });
        setActiveGroupId(null);
        setGroupQuestionCount(0);
        setGroupMode(false);
        setPassageEn('');
        setPassageHi('');
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
                            options: { ...prev.options, [optKey]: (prev.options[optKey] || '') + ` ${imageTag}` }
                        }));
                    } else {
                        setter(prev => ({ ...prev, text: prev.text + `\n\n${imageTag}` }));
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

        setSubmitting(true);
        setMessage(null);

        try {
            const nextOrder = activeGroupId ? groupQuestionCount + 1 : null;

            // Auto-set subtype for group mode
            const effectiveSubtype = activeGroupId
                ? (groupType === 'CLOZE' ? 'cloze_test' : 'reading_comprehension')
                : (subtype || null);

            const res = await fetch('/api/question-entry/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    exam_section_id: selectedSectionId || null,
                    difficulty: difficulty || null,
                    source_question_no: sourceQNo || null,
                    correct_answer: correctAnswer || null,
                    group_id: activeGroupId || null,
                    group_order: nextOrder,
                    subtype: effectiveSubtype,
                    solution_text: solutionText || null,
                    ca_period: isCurrentAffairs && caPeriod ? caPeriod : null,
                    english,
                    hindi
                })
            });

            const data = await res.json();

            if (data.success) {
                setSavedCount(prev => prev + 1);

                if (activeGroupId) {
                    const newCount = groupQuestionCount + 1;
                    setGroupQuestionCount(newCount);
                    setMessage({ type: 'success', text: `${groupType} Q${newCount} saved!` });
                } else {
                    setMessage({ type: 'success', text: `Question ${sourceQNo || '#' + (savedCount + 1)} saved!` });
                }

                // Reset question form (keep selections like exam, section, subtype, CA toggle)
                setEnglish({ text: '', options: { A: '', B: '', C: '', D: '' } });
                setHindi({ text: '', options: { A: '', B: '', C: '', D: '' } });
                setCorrectAnswer('');
                setSolutionText('');
                setQuestionId(prev => prev + 1);

                if (sourceQNo) {
                    const num = parseInt(sourceQNo.replace(/\D/g, ''), 10);
                    if (!isNaN(num)) {
                        setSourceQNo(String(num + 1));
                    } else {
                        setSourceQNo('');
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
                    <div className="flex items-center gap-3">
                        {savedCount > 0 && (
                            <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-bold">
                                {savedCount} saved
                            </span>
                        )}
                        {!activeGroupId && (
                            <button
                                type="button"
                                onClick={() => setGroupMode(!groupMode)}
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${groupMode
                                    ? 'bg-purple-600 text-white shadow-sm'
                                    : 'bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100'
                                    }`}
                            >
                                {groupMode ? 'RC/Cloze Mode ON' : 'RC/Cloze Group'}
                            </button>
                        )}
                    </div>
                </div>
                <p className="text-sm text-gray-500">Enter new bilingual questions directly into the database.</p>
            </div>

            {/* Selection Bar */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-6">
                <div className="flex flex-wrap gap-4 items-end mb-4">
                    <div className="flex flex-col gap-1 min-w-[220px]">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Exam</label>
                        <select
                            value={selectedExamId}
                            onChange={(e) => { setSelectedExamId(e.target.value); setSelectedSectionId(''); }}
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="">-- Select Exam --</option>
                            {exams.map(e => <option key={e.exam_id} value={e.exam_id}>{e.name}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1 min-w-[220px]">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Section</label>
                        <select
                            value={selectedSectionId}
                            onChange={(e) => setSelectedSectionId(e.target.value)}
                            disabled={!selectedExamId}
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                        >
                            <option value="">-- Select Section --</option>
                            {sections.map(s => <option key={s.section_id} value={s.section_id}>{s.name}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1 min-w-[180px]">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Subtype</label>
                        <div className="flex gap-1">
                            <select
                                value={subtype}
                                onChange={(e) => setSubtype(e.target.value)}
                                disabled={!selectedSectionId && !activeGroupId}
                                className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                            >
                                <option value="">-- Select --</option>
                                {subtypes.map(s => <option key={s.subtype} value={s.subtype}>{s.subtype} ({s.cnt})</option>)}
                            </select>
                            <input
                                type="text"
                                placeholder="or type new..."
                                value={subtype && !subtypes.find(s => s.subtype === subtype) ? subtype : ''}
                                onChange={(e) => setSubtype(e.target.value)}
                                className="w-28 border border-gray-300 rounded-md px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                    </div>
                    <div className="flex flex-col gap-1 min-w-[120px]">
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
                </div>
                <div className="flex flex-wrap gap-4 items-end">
                    <div className="flex flex-col gap-1 min-w-[120px]">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Q. No. <span className="normal-case text-gray-400">(optional)</span></label>
                        <input
                            type="text"
                            placeholder="e.g. 1"
                            value={sourceQNo}
                            onChange={(e) => setSourceQNo(e.target.value)}
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Correct Answer <span className="normal-case text-gray-400">(optional)</span></label>
                        <div className="flex gap-1">
                            {OPTION_KEYS.map(key => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setCorrectAnswer(prev => prev === key ? '' : key)}
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
                    {/* Current Affairs toggle */}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Current Affairs</label>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsCurrentAffairs(!isCurrentAffairs);
                                    if (!isCurrentAffairs && !subtype) setSubtype('current_affairs');
                                    if (!isCurrentAffairs && !caPeriod) {
                                        const now = new Date();
                                        setCaPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
                                    }
                                }}
                                className={`px-3 py-2 rounded-md text-sm font-bold transition-all ${isCurrentAffairs
                                    ? 'bg-teal-600 text-white shadow-sm'
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-300'
                                    }`}
                            >
                                {isCurrentAffairs ? 'CA ON' : 'CA'}
                            </button>
                            {isCurrentAffairs && (
                                <input
                                    type="month"
                                    value={caPeriod}
                                    onChange={(e) => setCaPeriod(e.target.value)}
                                    className="border border-teal-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-teal-50"
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══ GROUP MODE: Passage Panel ═══ */}
            {groupMode && !activeGroupId && (
                <div className="bg-purple-50 border-2 border-purple-300 rounded-xl p-5 shadow-sm mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <h2 className="text-lg font-bold text-purple-900">Passage / Comprehension</h2>
                            <div className="flex gap-1">
                                {['RC', 'CLOZE'].map(t => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => setGroupType(t)}
                                        className={`px-3 py-1 text-xs font-bold rounded transition-all ${groupType === t
                                            ? 'bg-purple-600 text-white'
                                            : 'bg-white text-purple-600 border border-purple-300 hover:bg-purple-100'
                                            }`}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => { setGroupMode(false); setPassageEn(''); setPassageHi(''); }}
                            className="text-xs text-gray-500 hover:text-gray-700"
                        >
                            Cancel
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        {/* English Passage */}
                        <div>
                            <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">English Passage</label>
                            <textarea
                                className="w-full p-3 border border-purple-200 rounded font-mono text-sm min-h-[150px] resize-y focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                value={passageEn}
                                onChange={(e) => setPassageEn(e.target.value)}
                                placeholder="Enter the reading comprehension passage in English..."
                            />
                            <div className="mt-2 p-3 bg-white rounded border border-gray-200 text-sm max-h-[200px] overflow-y-auto">
                                <p className="text-xs font-bold text-gray-400 uppercase mb-1">Preview</p>
                                <Latex>{passageEn || ''}</Latex>
                            </div>
                        </div>
                        {/* Hindi Passage */}
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-xs font-semibold text-gray-500 uppercase">Hindi Passage</label>
                                <button
                                    type="button"
                                    onClick={handleTranslatePassage}
                                    disabled={translatingPassage}
                                    className="px-3 py-1 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-50"
                                >
                                    {translatingPassage ? '...' : 'Translate EN → HI'}
                                </button>
                            </div>
                            <textarea
                                className="w-full p-3 border border-purple-200 rounded font-mono text-sm min-h-[150px] resize-y focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                value={passageHi}
                                onChange={(e) => setPassageHi(e.target.value)}
                                placeholder="हिंदी अनुच्छेद यहाँ दर्ज करें..."
                            />
                            <div className="mt-2 p-3 bg-white rounded border border-gray-200 text-sm max-h-[200px] overflow-y-auto">
                                <p className="text-xs font-bold text-gray-400 uppercase mb-1">Preview</p>
                                <Latex>{passageHi || ''}</Latex>
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleStartGroup}
                        disabled={creatingGroup}
                        className="px-6 py-2.5 bg-purple-600 text-white rounded-lg font-bold text-sm hover:bg-purple-700 transition-all shadow disabled:opacity-50"
                    >
                        {creatingGroup ? 'Creating...' : `Start ${groupType} Group — Begin Adding Questions`}
                    </button>
                </div>
            )}

            {/* ═══ ACTIVE GROUP BANNER ═══ */}
            {activeGroupId && (
                <div className="bg-purple-100 border-2 border-purple-400 rounded-xl px-5 py-4 mb-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <span className="bg-purple-600 text-white text-xs font-bold px-2.5 py-1 rounded">{groupType}</span>
                        <div>
                            <p className="text-sm font-bold text-purple-900">
                                Group active — {groupQuestionCount} question{groupQuestionCount !== 1 ? 's' : ''} added
                            </p>
                            <p className="text-xs text-purple-600 truncate max-w-md">
                                {passageEn.substring(0, 80)}{passageEn.length > 80 ? '...' : ''}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleFinishGroup}
                        className="px-4 py-2 bg-purple-700 text-white rounded-lg text-sm font-bold hover:bg-purple-800 transition-colors"
                    >
                        Finish Group
                    </button>
                </div>
            )}

            {/* Toast */}
            {message && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${message.type === 'success'
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                    }`}>
                    {message.text}
                </div>
            )}

            {/* Copy & Translate Buttons */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-5 py-3 mb-4 flex gap-3 flex-wrap items-center">
                <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Quick Copy</span>
                <button type="button" onClick={() => setHindi(prev => ({ ...prev, text: english.text }))}
                    className="px-3 py-1 text-xs font-semibold bg-white border border-amber-300 text-amber-700 rounded hover:bg-amber-100 transition-colors">
                    Copy Question to Hindi
                </button>
                <button type="button" onClick={() => setHindi(prev => ({ ...prev, options: { ...english.options } }))}
                    className="px-3 py-1 text-xs font-semibold bg-white border border-amber-300 text-amber-700 rounded hover:bg-amber-100 transition-colors">
                    Copy Options to Hindi
                </button>
                <button type="button" onClick={() => setHindi({ text: english.text, options: { ...english.options } })}
                    className="px-3 py-1 text-xs font-semibold bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors">
                    Copy All to Hindi
                </button>
            </div>

            {/* Solution / Explanation */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm mb-4">
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-500 uppercase">Solution / Explanation <span className="normal-case text-gray-400">(optional)</span></label>
                    {solutionText && (
                        <span className="text-[10px] text-green-600 font-medium">Has solution</span>
                    )}
                </div>
                <textarea
                    value={solutionText}
                    onChange={(e) => setSolutionText(e.target.value)}
                    rows={2}
                    placeholder="Enter solution explanation... (supports LaTeX)"
                    className="w-full p-3 border border-gray-300 rounded font-mono text-sm resize-y focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {solutionText && (
                    <div className="mt-2 p-3 bg-gray-50 rounded border border-gray-200 text-sm">
                        <p className="text-xs font-bold text-gray-400 uppercase mb-1">Preview</p>
                        <Latex>{solutionText}</Latex>
                    </div>
                )}
            </div>

            {/* Bilingual Panels */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
                    <div className="p-5">
                        <LanguagePanel
                            lang="EN" label="English" color="blue"
                            data={english} onChange={handleEnglishChange}
                            questionId={questionId} onImageUpload={handleImageUpload} uploading={uploading}
                            onTranslate={() => handleTranslate('hi')} translating={translatingEng}
                        />
                    </div>
                    <div className="p-5">
                        <LanguagePanel
                            lang="HI" label="Hindi" color="orange"
                            data={hindi} onChange={handleHindiChange}
                            questionId={questionId} onImageUpload={handleImageUpload} uploading={uploading}
                            onTranslate={() => handleTranslate('en')} translating={translatingHin}
                        />
                    </div>
                </div>

                {/* Save Bar */}
                <div className="border-t border-gray-200 bg-gray-50 px-5 py-4 flex justify-between items-center">
                    <div className="text-xs text-gray-400">
                        Ctrl+S to save
                        {activeGroupId && <span className="ml-2 text-purple-600 font-semibold">Next: {groupType} Q{groupQuestionCount + 1}</span>}
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={submitting}
                        className={`px-6 py-2.5 rounded-lg font-bold text-sm transition-all shadow ${submitting
                            ? 'bg-blue-400 text-white cursor-wait'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                    >
                        {submitting ? 'Saving...' : activeGroupId ? `Save ${groupType} Q${groupQuestionCount + 1}` : 'Save Question'}
                    </button>
                </div>
            </div>
        </div>
    );
}
