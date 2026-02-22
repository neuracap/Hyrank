'use client';

import { useState } from 'react';

function PdfLink({ path, label, colorClass = 'text-blue-600 border-blue-200 bg-blue-50 hover:bg-blue-100' }) {
    if (!path) return <span className="text-xs text-gray-400 italic">No PDF linked</span>;
    const url = `/api/pdf?path=${encodeURIComponent(path)}`;
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${colorClass}`}
        >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" />
                <path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" />
            </svg>
            {label}
        </a>
    );
}

function QuestionGrid({ questionNos, title, colorClass = 'bg-blue-100 text-blue-800' }) {
    // Parse question numbers to integers for gap detection
    const nums = questionNos
        .map(q => parseInt(q.replace(/[^0-9]/g, ''), 10))
        .filter(n => !isNaN(n))
        .sort((a, b) => a - b);

    const max = nums.length > 0 ? Math.max(...nums) : 0;

    // Build a set for quick lookup
    const present = new Set(nums);

    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wide">{title}</h3>
                <span className="text-xs text-gray-400">{questionNos.length} questions</span>
            </div>
            {max === 0 ? (
                <p className="text-xs text-gray-400 italic">No questions yet</p>
            ) : (
                <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto pr-1">
                    {Array.from({ length: max }, (_, i) => i + 1).map(n => {
                        const isPresent = present.has(n);
                        return (
                            <span
                                key={n}
                                title={isPresent ? `Q.${n} present` : `Q.${n} MISSING`}
                                className={`inline-flex items-center justify-center text-[10px] font-bold w-7 h-7 rounded ${isPresent
                                        ? colorClass
                                        : 'bg-red-100 text-red-600 ring-1 ring-red-300'
                                    }`}
                            >
                                {n}
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

const EMPTY_LANG = { text: '', options: { A: '', B: '', C: '', D: '' } };

export default function AddBilingualQuestionForm({
    engSessionId,
    engSessionLabel,
    engPdfPath,
    hinSessionId,
    hinSessionLabel,
    hinPdfPath,
    engQuestionNos,
    hinQuestionNos,
    sections,
}) {
    const [english, setEnglish] = useState({ ...EMPTY_LANG, options: { ...EMPTY_LANG.options } });
    const [hindi, setHindi] = useState({ ...EMPTY_LANG, options: { ...EMPTY_LANG.options } });
    const [sourceQuestionNo, setSourceQuestionNo] = useState('');
    const [sectionName, setSectionName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState(null); // { type: 'success'|'error', text }

    // Live grid state  — refreshes after successful submit
    const [engNos, setEngNos] = useState(engQuestionNos);
    const [hinNos, setHinNos] = useState(hinQuestionNos);

    const updateLang = (setter, field, value) => setter(prev => ({ ...prev, [field]: value }));
    const updateOpt = (setter, key, value) => setter(prev => ({ ...prev, options: { ...prev.options, [key]: value } }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!hinSessionId) {
            setMessage({ type: 'error', text: 'No Hindi session found for this paper. Cannot create linked question.' });
            return;
        }
        setSubmitting(true);
        setMessage(null);

        try {
            const res = await fetch('/api/question/create-bilingual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    eng_session_id: engSessionId,
                    hin_session_id: hinSessionId,
                    section_name: sectionName || null,
                    source_question_no: sourceQuestionNo || null,
                    english,
                    hindi,
                }),
            });

            const data = await res.json();

            if (data.success) {
                setMessage({ type: 'success', text: `✅ Question ${data.sourceQuestionNo} added successfully!` });
                // Update grids
                if (sourceQuestionNo) {
                    setEngNos(prev => [...prev, sourceQuestionNo].sort());
                    setHinNos(prev => [...prev, sourceQuestionNo].sort());
                }
                // Reset form
                setEnglish({ text: '', options: { A: '', B: '', C: '', D: '' } });
                setHindi({ text: '', options: { A: '', B: '', C: '', D: '' } });
                setSourceQuestionNo('');
            } else {
                setMessage({ type: 'error', text: `❌ Error: ${data.error || 'Unknown error'}` });
            }
        } catch (err) {
            setMessage({ type: 'error', text: `❌ Network error: ${err.message}` });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 py-8">

                {/* ── Header ── */}
                <header className="mb-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                    <div className="flex justify-between items-start flex-wrap gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">➕ Add Missing Question</h1>
                            <p className="text-sm text-gray-500 mt-1">Add a question to both English and Hindi sessions simultaneously.</p>
                        </div>
                        <a href="/bilingdash" className="text-blue-600 hover:text-blue-800 font-medium text-sm">← Back to BiLingDash</a>
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* English side */}
                        <div className="flex items-center gap-3 bg-blue-50 rounded-lg px-4 py-3 border border-blue-100">
                            <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded">EN</span>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-800 truncate">{engSessionLabel || engSessionId}</p>
                            </div>
                            <PdfLink path={engPdfPath} label="Open PDF" colorClass="text-blue-700 border-blue-300 bg-white hover:bg-blue-50" />
                        </div>

                        {/* Hindi side */}
                        <div className="flex items-center gap-3 bg-orange-50 rounded-lg px-4 py-3 border border-orange-100">
                            <span className="bg-orange-600 text-white text-xs font-bold px-2 py-0.5 rounded">HI</span>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-800 truncate">
                                    {hinSessionLabel || (hinSessionId ? hinSessionId : <span className="italic text-red-500">Hindi session not found</span>)}
                                </p>
                            </div>
                            <PdfLink path={hinPdfPath} label="Open PDF" colorClass="text-orange-700 border-orange-300 bg-white hover:bg-orange-50" />
                        </div>
                    </div>
                </header>

                {/* ── Question Grids ── */}
                <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                    <h2 className="text-sm font-bold text-gray-700 mb-4 uppercase tracking-wide">Existing Questions — Gaps = Missing</h2>
                    <div className="flex gap-6 flex-wrap">
                        <QuestionGrid
                            questionNos={engNos}
                            title={`English (${engNos.length})`}
                            colorClass="bg-blue-100 text-blue-800"
                        />
                        <div className="w-px bg-gray-200 self-stretch hidden md:block" />
                        <QuestionGrid
                            questionNos={hinNos}
                            title={`Hindi (${hinNos.length})`}
                            colorClass="bg-orange-100 text-orange-800"
                        />
                    </div>
                    <p className="text-xs text-red-500 mt-3">
                        <span className="inline-block w-5 h-5 rounded bg-red-100 text-red-600 ring-1 ring-red-300 text-center text-[10px] font-bold leading-5 mr-1">?</span>
                        Red pills = missing question numbers
                    </p>
                </div>

                {/* ── Toast ── */}
                {message && (
                    <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
                        }`}>
                        {message.text}
                    </div>
                )}

                {/* ── Form ── */}
                <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                    {/* Shared fields bar */}
                    <div className="border-b border-gray-100 bg-gray-50 px-5 py-4 flex flex-wrap gap-4 items-end">
                        <div className="flex flex-col gap-1 min-w-[140px]">
                            <label className="text-xs font-semibold text-gray-500 uppercase">Source Q. No.</label>
                            <input
                                type="text"
                                placeholder="e.g. Q.98"
                                value={sourceQuestionNo}
                                onChange={e => setSourceQuestionNo(e.target.value)}
                                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                        {sections.length > 0 && (
                            <div className="flex flex-col gap-1 min-w-[200px]">
                                <label className="text-xs font-semibold text-gray-500 uppercase">Section</label>
                                <select
                                    value={sectionName}
                                    onChange={e => setSectionName(e.target.value)}
                                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                >
                                    <option value="">— No Section —</option>
                                    {sections.map(s => (
                                        <option key={s.section_id} value={s.code || s.name}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    {/* Side-by-side English & Hindi */}
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                        {/* English column */}
                        <div className="p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded">EN</span>
                                <h3 className="font-bold text-gray-700">English</h3>
                            </div>

                            <div className="mb-3">
                                <label className="text-xs font-semibold text-gray-500 uppercase block mb-1">Question Text</label>
                                <textarea
                                    rows={4}
                                    placeholder="Enter English question text…"
                                    value={english.text}
                                    onChange={e => updateLang(setEnglish, 'text', e.target.value)}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                                    required
                                />
                            </div>

                            {['A', 'B', 'C', 'D'].map(key => (
                                <div key={key} className="mb-2 flex items-center gap-2">
                                    <span className="text-xs font-bold text-gray-500 w-5">{key}</span>
                                    <input
                                        type="text"
                                        placeholder={`Option ${key}`}
                                        value={english.options[key]}
                                        onChange={e => updateOpt(setEnglish, key, e.target.value)}
                                        className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>
                            ))}
                        </div>

                        {/* Hindi column */}
                        <div className="p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <span className="bg-orange-600 text-white text-xs font-bold px-2 py-0.5 rounded">HI</span>
                                <h3 className="font-bold text-gray-700">Hindi</h3>
                            </div>

                            <div className="mb-3">
                                <label className="text-xs font-semibold text-gray-500 uppercase block mb-1">Question Text</label>
                                <textarea
                                    rows={4}
                                    placeholder="हिंदी प्रश्न यहाँ दर्ज करें…"
                                    value={hindi.text}
                                    onChange={e => updateLang(setHindi, 'text', e.target.value)}
                                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-y"
                                    required
                                />
                            </div>

                            {['A', 'B', 'C', 'D'].map(key => (
                                <div key={key} className="mb-2 flex items-center gap-2">
                                    <span className="text-xs font-bold text-gray-500 w-5">{key}</span>
                                    <input
                                        type="text"
                                        placeholder={`विकल्प ${key}`}
                                        value={hindi.options[key]}
                                        onChange={e => updateOpt(setHindi, key, e.target.value)}
                                        className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Submit */}
                    <div className="border-t border-gray-100 bg-gray-50 px-5 py-4 flex justify-end">
                        <button
                            type="submit"
                            disabled={submitting || !hinSessionId}
                            className={`px-6 py-2.5 rounded-lg font-bold text-sm transition-all shadow ${!hinSessionId
                                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                    : submitting
                                        ? 'bg-indigo-400 text-white cursor-wait'
                                        : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                }`}
                        >
                            {submitting ? 'Saving…' : '➕ Add Question to Both Papers'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
