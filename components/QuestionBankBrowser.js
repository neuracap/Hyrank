'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Latex from '@/components/Latex';

const DIFF_LABELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const DIFF_COLORS = { 1: 'bg-green-100 text-green-700', 2: 'bg-yellow-100 text-yellow-700', 3: 'bg-red-100 text-red-700' };

function toArray(v) { return Array.isArray(v) ? v : []; }

function sectionPreviewLines(content) {
    return (content || '').replace(/\\n/g, '\n').split('\n');
}

function QuestionCard({ q }) {
    const [open, setOpen] = useState(false);
    const sj = q.solution_json || {};
    const ao = sj.answer_outcome || {};
    const sections = toArray(sj.display_sections);
    const hasSolution = q.solution_status === 'DONE';

    return (
        <div className={`bg-white rounded-lg border ${hasSolution ? 'border-gray-200' : 'border-amber-300'} overflow-hidden`}>
            {/* Header */}
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-gray-400">{(q.question_id || '').slice(0, 8)}</span>
                    {q.section_code && (
                        <span className="text-xs bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">{q.section_code}</span>
                    )}
                    {q.subtype && (
                        <span className="text-xs text-gray-500 bg-white border border-gray-200 px-1.5 py-0.5 rounded">{q.subtype}</span>
                    )}
                    {q.difficulty && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${DIFF_COLORS[q.difficulty]}`}>
                            {DIFF_LABELS[q.difficulty]}
                        </span>
                    )}
                    {q.correct && (
                        <span className="text-xs font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Ans: {q.correct}</span>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded ${hasSolution ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                        {hasSolution ? 'Solution: DONE' : (q.solution_status || 'PENDING')}
                    </span>
                    {q.source_type && (
                        <span className="text-xs text-gray-500 italic">{q.source_type}{q.paper_label ? ` · ${q.paper_label}` : ''}</span>
                    )}
                </div>
                <button
                    onClick={() => setOpen(o => !o)}
                    className="text-xs font-semibold text-blue-600 hover:underline"
                >
                    {open ? 'Hide solution' : (hasSolution ? 'Show solution' : 'No solution')}
                </button>
            </div>

            {/* Stem */}
            <div className="px-4 py-3 border-b border-gray-100">
                <div className="text-sm text-gray-800"><Latex>{q.text || '(No question text)'}</Latex></div>
            </div>

            {/* Options */}
            <div className="px-4 py-2 border-b border-gray-100">
                <div className="grid grid-cols-2 gap-2">
                    {(q.options || []).map(o => {
                        const isCorrect = q.correct === o.option_key || o.is_correct;
                        const isBlank = !o.opt_text || !o.opt_text.trim();
                        return (
                            <div key={o.option_key}
                                className={`flex gap-2 items-start p-2 rounded border text-sm ${isBlank ? 'bg-red-50 border-red-300' : isCorrect ? 'bg-green-50 border-green-400' : 'bg-white border-gray-200'}`}>
                                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${isCorrect ? 'bg-green-500 text-white border-green-500' : 'bg-gray-100 text-gray-600 border-gray-300'}`}>
                                    {o.option_key}
                                </span>
                                <div className="text-sm text-gray-700 flex-1">
                                    {isBlank ? <span className="text-red-500 italic font-semibold">BLANK</span> : <Latex>{o.opt_text}</Latex>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Solution (expandable) */}
            {open && hasSolution && (
                <div className="px-4 py-3 bg-gray-50/40 border-b border-gray-100 space-y-3">
                    {ao.core_answer_basis && (
                        <div>
                            <div className="text-[10px] font-bold text-gray-500 uppercase mb-0.5">Core Answer Basis</div>
                            <div className="text-sm text-gray-800"><Latex>{ao.core_answer_basis}</Latex></div>
                        </div>
                    )}
                    {ao.figure_url && (
                        <div>
                            <div className="text-[10px] font-bold text-gray-500 uppercase mb-1">Figure</div>
                            <img src={ao.figure_url} alt="Solution figure" className="max-h-64 rounded border border-gray-200 object-contain" />
                        </div>
                    )}
                    {sections.length > 0 && (
                        <div className="space-y-2">
                            {sections.map((s, i) => (
                                <div key={i}>
                                    <div className="text-[10px] font-bold text-gray-500 uppercase mb-0.5">
                                        {(s.key || '').replace(/_/g, ' ')}
                                    </div>
                                    {sectionPreviewLines(s.content).map((line, li) => (
                                        <div key={li} className={`text-sm text-gray-800 ${line.trim() ? '' : 'h-2'}`}>
                                            {line.trim() ? <Latex>{line}</Latex> : null}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function QuestionBankBrowser({ exams }) {
    const [examId, setExamId]       = useState('');
    const [sections, setSections]   = useState([]);
    const [sectionId, setSectionId] = useState('');
    const [language, setLanguage]   = useState('EN');
    const [source, setSource]       = useState('bank');
    const [difficulty, setDifficulty] = useState('');
    const [hasSolution, setHasSolution] = useState('');
    const [query, setQuery]         = useState('');
    const [page, setPage]           = useState(1);
    const [pageSize]                = useState(25);

    const [questions, setQuestions] = useState([]);
    const [total, setTotal]         = useState(0);
    const [loading, setLoading]     = useState(false);
    const [error, setError]         = useState(null);

    // Fetch sections when exam changes
    useEffect(() => {
        if (!examId) { setSections([]); setSectionId(''); return; }
        let cancelled = false;
        fetch(`/api/exam/sections?exam_id=${examId}`)
            .then(r => r.json())
            .then(d => { if (!cancelled) setSections(d.sections || []); })
            .catch(() => { if (!cancelled) setSections([]); });
        setSectionId('');
        return () => { cancelled = true; };
    }, [examId]);

    // Debounce the search query so we don't fire on every keystroke.
    const debouncedQuery = useDebouncedValue(query, 350);

    // Fetch questions when any filter changes
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        if (examId)     params.set('exam_id', examId);
        if (sectionId)  params.set('section_id', sectionId);
        if (language)   params.set('language', language);
        if (source)     params.set('source', source);
        if (difficulty) params.set('difficulty', difficulty);
        if (hasSolution) params.set('has_solution', hasSolution);
        if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
        params.set('page', String(page));
        params.set('page_size', String(pageSize));

        fetch(`/api/question-bank/list?${params.toString()}`)
            .then(async r => {
                const j = await r.json();
                if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
                return j;
            })
            .then(d => {
                if (cancelled) return;
                setQuestions(d.questions || []);
                setTotal(d.total || 0);
            })
            .catch(e => { if (!cancelled) setError(e.message); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [examId, sectionId, language, source, difficulty, hasSolution, debouncedQuery, page, pageSize]);

    // Reset to page 1 whenever a non-page filter changes.
    useEffect(() => { setPage(1); }, [examId, sectionId, language, source, difficulty, hasSolution, debouncedQuery]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Filter bar */}
            <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 py-3 space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-lg font-bold text-gray-900 flex-shrink-0">Question Bank</h1>

                        <select value={examId} onChange={e => setExamId(e.target.value)}
                            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm min-w-[180px]">
                            <option value="">All exams</option>
                            {exams.map(e => (
                                <option key={e.exam_id} value={e.exam_id}>{e.name}</option>
                            ))}
                        </select>

                        <select value={sectionId} onChange={e => setSectionId(e.target.value)}
                            disabled={!examId}
                            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm min-w-[160px] disabled:bg-gray-50 disabled:text-gray-400">
                            <option value="">{examId ? 'All sections' : 'Pick exam first'}</option>
                            {sections.map(s => (
                                <option key={s.section_id} value={s.section_id}>{s.code} — {s.name}</option>
                            ))}
                        </select>

                        <div className="flex gap-1">
                            {['EN', 'HI'].map(l => (
                                <button key={l} onClick={() => setLanguage(l)}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${language === l ? (l === 'EN' ? 'bg-blue-600 text-white' : 'bg-orange-600 text-white') : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                    {l === 'EN' ? 'English' : 'Hindi'}
                                </button>
                            ))}
                        </div>

                        <input
                            type="search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search question text…"
                            className="flex-1 min-w-[200px] border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                        />

                        <span className="text-xs text-gray-500 ml-auto">
                            {loading ? 'Loading…' : `${total.toLocaleString()} result${total === 1 ? '' : 's'}`}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase text-gray-400">Source:</span>
                        {[
                            { val: 'bank', label: 'Bank' },
                            { val: 'pyq',  label: 'PYQ' },
                            { val: 'all',  label: 'All' },
                        ].map(s => (
                            <button key={s.val} onClick={() => setSource(s.val)}
                                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${source === s.val ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                {s.label}
                            </button>
                        ))}

                        <span className="text-[10px] font-bold uppercase text-gray-400 ml-3">Difficulty:</span>
                        {[
                            { val: '',  label: 'Any' },
                            { val: '1', label: 'Easy' },
                            { val: '2', label: 'Medium' },
                            { val: '3', label: 'Hard' },
                        ].map(d => (
                            <button key={d.val || 'any'} onClick={() => setDifficulty(d.val)}
                                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${difficulty === d.val ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                {d.label}
                            </button>
                        ))}

                        <span className="text-[10px] font-bold uppercase text-gray-400 ml-3">Solution:</span>
                        {[
                            { val: '',      label: 'Any' },
                            { val: 'true',  label: 'Done' },
                            { val: 'false', label: 'Pending' },
                        ].map(h => (
                            <button key={h.val || 'any'} onClick={() => setHasSolution(h.val)}
                                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${hasSolution === h.val ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                {h.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* List */}
            <div className="max-w-7xl mx-auto px-4 py-5">
                {error && (
                    <div className="mb-4 px-4 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">
                        Error: {error}
                    </div>
                )}

                {loading && questions.length === 0 && (
                    <div className="text-center py-24 text-gray-400">
                        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
                        <div className="mt-3 text-sm">Loading questions…</div>
                    </div>
                )}

                {!loading && questions.length === 0 && (
                    <div className="text-center py-24 text-gray-400 text-sm">
                        No questions match these filters.
                    </div>
                )}

                <div className="space-y-3">
                    {questions.map(q => (
                        <QuestionCard key={`${q.question_id}|${q.language}`} q={q} />
                    ))}
                </div>

                {/* Pagination */}
                {total > pageSize && (
                    <Pagination page={page} totalPages={totalPages} onChange={setPage} />
                )}
            </div>
        </div>
    );
}

function Pagination({ page, totalPages, onChange }) {
    // Build a compact page-number list: first, last, current ±2, with ellipses.
    const pageNums = useMemo(() => {
        const set = new Set([1, totalPages, page - 1, page, page + 1, page - 2, page + 2]);
        const arr = [...set].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
        const withGaps = [];
        for (let i = 0; i < arr.length; i++) {
            if (i > 0 && arr[i] - arr[i - 1] > 1) withGaps.push('…');
            withGaps.push(arr[i]);
        }
        return withGaps;
    }, [page, totalPages]);

    return (
        <div className="mt-6 flex items-center justify-center gap-1 text-sm">
            <button
                disabled={page <= 1}
                onClick={() => onChange(page - 1)}
                className="px-3 py-1.5 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                Previous
            </button>
            {pageNums.map((n, i) => (
                n === '…'
                    ? <span key={`gap-${i}`} className="px-2 text-gray-400">…</span>
                    : <button key={n}
                        onClick={() => onChange(n)}
                        className={`min-w-[2.25rem] px-2 py-1.5 rounded-md ${n === page ? 'bg-blue-600 text-white font-semibold' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                        {n}
                    </button>
            ))}
            <button
                disabled={page >= totalPages}
                onClick={() => onChange(page + 1)}
                className="px-3 py-1.5 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                Next
            </button>
        </div>
    );
}

function useDebouncedValue(value, delayMs) {
    const [debounced, setDebounced] = useState(value);
    const timer = useRef(null);
    useEffect(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setDebounced(value), delayMs);
        return () => { if (timer.current) clearTimeout(timer.current); };
    }, [value, delayMs]);
    return debounced;
}
