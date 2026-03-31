'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Latex from './Latex';
import Link from 'next/link';

function BlankCard({ q }) {
    const [questionText, setQuestionText] = useState(q.question_text || '');
    const [options, setOptions] = useState(
        (q.options || []).map(o => ({ opt_label: o.opt_label, opt_text: o.opt_text || '' }))
    );
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState(null);

    const isBlank = (text) => !text || !text.trim();

    const handleSave = async () => {
        setSaving(true);
        setMsg(null);
        try {
            const res = await fetch('/api/question/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: q.id,
                    version_no: q.version_no,
                    language: q.language,
                    question_text: questionText,
                    options: options.map(o => ({ opt_label: o.opt_label, opt_text: o.opt_text })),
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setMsg('Saved!');
                setEditing(false);
                setTimeout(() => setMsg(null), 2000);
            } else {
                setMsg('Error: ' + (data.error || 'Failed'));
            }
        } catch (e) {
            setMsg('Error: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    const blankKeys = (q.blank_keys || []).filter(Boolean);

    return (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-4 py-2 bg-gray-50 border-b flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-gray-700">Q.{q.source_question_no || q.question_number_int || '?'}</span>
                    <span className="text-xs font-mono text-gray-400">{(q.id || '').slice(0, 8)}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${q.language === 'EN' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{q.language}</span>
                    {q.section_code && <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{q.section_code}</span>}
                    {q.exam_name && <span className="text-xs text-gray-500">{q.exam_name}</span>}
                    <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-semibold">
                        Blank: {blankKeys.join(', ')}
                    </span>
                    {q.session_label && <span className="text-xs text-gray-400 truncate max-w-[200px]">{q.session_label}</span>}
                </div>
                <div className="flex items-center gap-2">
                    {msg && <span className={`text-xs font-semibold ${msg === 'Saved!' ? 'text-green-600' : 'text-red-600'}`}>{msg}</span>}
                    {editing ? (
                        <>
                            <button onClick={handleSave} disabled={saving}
                                className="px-2.5 py-1 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                                {saving ? '...' : 'Save'}
                            </button>
                            <button onClick={() => { setEditing(false); setQuestionText(q.question_text || ''); setOptions((q.options || []).map(o => ({ opt_label: o.opt_label, opt_text: o.opt_text || '' }))); }}
                                className="px-2.5 py-1 text-xs font-semibold bg-gray-200 text-gray-600 rounded hover:bg-gray-300">
                                Cancel
                            </button>
                        </>
                    ) : (
                        <button onClick={() => setEditing(true)}
                            className="px-2.5 py-1 text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-300 rounded hover:bg-gray-200">
                            Edit
                        </button>
                    )}
                    {q.source_pdf_path && (
                        <a href={`/api/pdf?path=${encodeURIComponent(q.source_pdf_path)}`} target="_blank" rel="noopener noreferrer"
                            className="px-2.5 py-1 text-xs font-semibold text-red-600 bg-white border border-red-200 rounded hover:bg-red-50 flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                                <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" />
                                <path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" />
                            </svg>
                            PDF
                        </a>
                    )}
                    <Link href={`/test?testId=${q.paper_session_id}&locked=true`} target="_blank"
                        className="px-2.5 py-1 text-xs font-semibold bg-teal-50 text-teal-600 border border-teal-200 rounded hover:bg-teal-100">
                        Open Paper
                    </Link>
                </div>
            </div>

            {/* Question text */}
            <div className="px-4 py-3 border-b">
                {editing ? (
                    <textarea rows={3} value={questionText} onChange={e => setQuestionText(e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono resize-y" />
                ) : (
                    <div className="text-sm text-gray-800"><Latex>{q.question_text || '(No text)'}</Latex></div>
                )}
            </div>

            {/* Options */}
            <div className="px-4 py-3">
                <div className="grid grid-cols-2 gap-2">
                    {options.map((opt, idx) => {
                        const blank = isBlank(opt.opt_text);
                        return (
                            <div key={opt.opt_label}
                                className={`flex gap-2 items-start p-2 rounded border ${blank ? 'bg-red-50 border-red-400 ring-1 ring-red-200' : 'bg-white border-gray-200'}`}>
                                <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${blank ? 'bg-red-500 text-white border-red-500' : 'bg-gray-100 text-gray-600 border-gray-300'}`}>
                                    {opt.opt_label}
                                </span>
                                {editing ? (
                                    <input type="text" value={opt.opt_text}
                                        onChange={e => { const n = [...options]; n[idx] = { ...opt, opt_text: e.target.value }; setOptions(n); }}
                                        className={`flex-1 border rounded px-2 py-1 text-xs font-mono ${blank ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                                        placeholder="Enter option text..." />
                                ) : (
                                    <div className="text-sm text-gray-700 pt-0.5 flex-1">
                                        {blank ? (
                                            <span className="text-red-500 italic font-semibold">BLANK</span>
                                        ) : (
                                            <Latex>{opt.opt_text}</Latex>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export default function BlankOptionsAudit({ questions, total, currentPage, totalPages, exams, examFilter }) {
    const router = useRouter();

    const handleExamChange = (val) => {
        const params = new URLSearchParams();
        if (val !== 'ALL') params.set('exam', val);
        router.push(`/blank-options?${params.toString()}`);
    };

    const handlePageChange = (newPage) => {
        const params = new URLSearchParams(window.location.search);
        params.set('page', newPage);
        router.push(`/blank-options?${params.toString()}`);
    };

    return (
        <div className="bg-gray-50 min-h-screen">
            <div className="container mx-auto px-4 py-8 max-w-6xl">
                <header className="mb-6 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                    <h1 className="text-2xl font-bold text-gray-900 mb-1">Blank Options Audit</h1>
                    <p className="text-sm text-gray-500">
                        MANUALLY_CORRECTED questions that still have 1-3 blank option choices (A/B/C/D).
                    </p>
                    <p className="text-sm font-semibold text-red-700 mt-2">
                        {total} question{total !== 1 ? 's' : ''} found
                    </p>
                </header>

                {/* Filters */}
                <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 mb-6 flex items-center gap-4">
                    <label className="text-sm font-semibold text-gray-700">Exam:</label>
                    <select value={examFilter} onChange={e => handleExamChange(e.target.value)}
                        className="text-sm border-gray-300 rounded-md px-3 py-1.5">
                        <option value="ALL">All Exams</option>
                        {exams.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                    {examFilter !== 'ALL' && (
                        <button onClick={() => handleExamChange('ALL')} className="text-sm text-gray-500 hover:text-red-600">
                            Clear
                        </button>
                    )}
                </div>

                {/* Questions */}
                <div className="space-y-4">
                    {questions.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">No questions with blank options found.</div>
                    ) : (
                        questions.map(q => <BlankCard key={`${q.id}-${q.language}`} q={q} />)
                    )}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="mt-8 flex items-center justify-center gap-2">
                        <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage <= 1}
                            className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">
                            Previous
                        </button>
                        <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
                        <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage >= totalPages}
                            className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">
                            Next
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
