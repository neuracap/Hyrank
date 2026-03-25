'use client';

import { useState } from 'react';
import Latex from '@/components/Latex';

const DIFF_LABELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const DIFF_COLORS = { 1: 'bg-green-100 text-green-700', 2: 'bg-yellow-100 text-yellow-700', 3: 'bg-red-100 text-red-700' };

function toArray(v) { return Array.isArray(v) ? v : []; }

// Single-language solution panel
function SolutionPanel({ lang, data, label }) {
    if (!data) return <div className="text-xs text-gray-400 italic p-3">No {label} version linked</div>;

    const sol = data.solution_json || {};
    const displaySections = toArray(sol.display_sections);
    const hasSolution = data.solution_status === 'DONE';

    return (
        <div className="flex-1 min-w-0">
            {/* Header */}
            <div className={`px-3 py-1.5 text-xs font-bold border-b flex items-center justify-between ${lang === 'en' ? 'bg-blue-50 text-blue-800' : 'bg-orange-50 text-orange-800'}`}>
                <span>{label} — {data.q_no || '?'}</span>
                <div className="flex items-center gap-1.5">
                    {data.subtype && <span className="font-normal bg-white px-1.5 py-0.5 rounded text-gray-600">{data.subtype}</span>}
                    {data.difficulty && <span className={`px-1.5 py-0.5 rounded font-semibold ${DIFF_COLORS[data.difficulty]}`}>{DIFF_LABELS[data.difficulty]}</span>}
                    {data.correct && <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">Ans: {data.correct}</span>}
                    <span className={`px-1.5 py-0.5 rounded ${hasSolution ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {hasSolution ? 'DONE' : data.solution_status || 'PENDING'}
                    </span>
                </div>
            </div>

            {/* Question text */}
            <div className="px-3 py-2 border-b bg-white">
                <div className="text-sm text-gray-800"><Latex>{data.text || '(No text)'}</Latex></div>
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                    {(data.options || []).map(o => (
                        <div key={o.option_key} className={`text-xs p-1.5 rounded border ${o.option_key === data.correct ? 'bg-green-50 border-green-300 font-semibold' : 'bg-white border-gray-200'}`}>
                            <span className="font-bold mr-1">{o.option_key})</span>
                            <Latex>{o.opt_text || ''}</Latex>
                        </div>
                    ))}
                </div>
            </div>

            {/* Solution */}
            {hasSolution && displaySections.length > 0 ? (
                <div className="px-3 py-2 space-y-2">
                    {displaySections.map((sec, i) => (
                        <div key={i}>
                            <div className="text-xs font-bold text-gray-600 uppercase mb-0.5">
                                {(sec.key || '').replace(/_/g, ' ')}
                            </div>
                            <div className="text-xs text-gray-700 leading-relaxed">
                                <Latex>{sec.content || ''}</Latex>
                            </div>
                        </div>
                    ))}
                    {data.answer_text && (
                        <div className="text-xs text-gray-500 mt-1">
                            Answer: <span className="font-semibold text-gray-700"><Latex>{data.answer_text}</Latex></span>
                        </div>
                    )}
                </div>
            ) : hasSolution ? (
                <div className="px-3 py-2 text-xs text-gray-500 italic">Solution data present but no display sections.</div>
            ) : (
                <div className="px-3 py-2 text-xs text-red-400 italic">No solution generated.</div>
            )}
        </div>
    );
}

// Bilingual question pair card
function BilingualCard({ pair, idx }) {
    const [expanded, setExpanded] = useState(true);

    const enDone = pair.en?.solution_status === 'DONE';
    const hiDone = pair.hi?.solution_status === 'DONE';
    const bothDone = enDone && hiDone;
    const answerMismatch = pair.en?.correct && pair.hi?.correct && pair.en.correct !== pair.hi.correct;

    return (
        <div className={`border rounded-lg overflow-hidden ${bothDone ? 'border-gray-200' : 'border-red-300'}`}>
            {/* Pair header */}
            <div className="px-3 py-1.5 bg-gray-50 border-b flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-600">#{idx + 1}</span>
                    {pair.section_code && <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{pair.section_code}</span>}
                    <span className="text-xs text-gray-400">Link #{pair.link_id}</span>
                    {answerMismatch && (
                        <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">
                            ANSWER MISMATCH: EN={pair.en.correct} HI={pair.hi.correct}
                        </span>
                    )}
                    {!bothDone && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                            {!enDone && !hiDone ? 'Both unsolved' : !enDone ? 'EN unsolved' : 'HI unsolved'}
                        </span>
                    )}
                </div>
                <span className="text-xs text-gray-400">{expanded ? '[-]' : '[+]'}</span>
            </div>

            {/* Side by side panels */}
            {expanded && (
                <div className="flex divide-x divide-gray-200">
                    <SolutionPanel lang="en" data={pair.en} label="English" />
                    <SolutionPanel lang="hi" data={pair.hi} label="Hindi" />
                </div>
            )}
        </div>
    );
}

export default function SolutionReviewBilingual({ exams }) {
    const [selectedExamId, setSelectedExamId] = useState('');
    const [papers, setPapers] = useState([]);
    const [loadingPapers, setLoadingPapers] = useState(false);
    const [selectedPair, setSelectedPair] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [filter, setFilter] = useState('all');
    const [feedback, setFeedback] = useState(null);

    const handleExamChange = async (examId) => {
        setSelectedExamId(examId);
        setSelectedPair(null);
        setQuestions([]);
        setPapers([]);
        if (!examId) return;

        setLoadingPapers(true);
        try {
            const res = await fetch(`/api/solution-review/bilingual-papers?exam_id=${examId}`);
            const data = await res.json();
            setPapers(res.ok ? (data.papers || []) : []);
        } catch { setPapers([]); }
        finally { setLoadingPapers(false); }
    };

    const handlePaperChange = async (val) => {
        if (!val) return;
        const [enId, hiId] = val.split('|');
        const pair = papers.find(p => p.en_session_id === enId && p.hi_session_id === hiId);
        setSelectedPair(pair);
        setQuestions([]);
        setFilter('all');
        setFeedback(null);
        setLoadingQuestions(true);

        try {
            const res = await fetch(`/api/solution-review/bilingual-questions?en_session_id=${enId}&hi_session_id=${hiId}`);
            const data = await res.json();
            if (res.ok) {
                setQuestions(data.questions || []);
            } else {
                setFeedback({ type: 'error', msg: data.error });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setLoadingQuestions(false);
        }
    };

    const filteredQuestions = questions.filter(q => {
        const enDone = q.en?.solution_status === 'DONE';
        const hiDone = q.hi?.solution_status === 'DONE';
        if (filter === 'both_solved') return enDone && hiDone;
        if (filter === 'unsolved') return !enDone || !hiDone;
        if (filter === 'mismatch') return q.en?.correct && q.hi?.correct && q.en.correct !== q.hi.correct;
        return true;
    });

    const bothSolvedCount = questions.filter(q => q.en?.solution_status === 'DONE' && q.hi?.solution_status === 'DONE').length;
    const mismatchCount = questions.filter(q => q.en?.correct && q.hi?.correct && q.en.correct !== q.hi.correct).length;

    // Group by section for sidebar
    const groupedQuestions = questions.reduce((acc, q, idx) => {
        const sec = q.section_code || 'Other';
        if (!acc[sec]) acc[sec] = [];
        acc[sec].push({ ...q, _idx: idx });
        return acc;
    }, {});

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-white">
            {/* Top Bar */}
            <div className="flex-shrink-0 bg-white border-b border-gray-200 shadow-sm px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-lg font-bold text-gray-900 flex-shrink-0">Bilingual Solution Review</h1>

                    <select value={selectedExamId} onChange={e => handleExamChange(e.target.value)}
                        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm min-w-[200px]">
                        <option value="">Select Exam...</option>
                        {exams.map(e => (
                            <option key={e.exam_id} value={e.exam_id}>{e.name}</option>
                        ))}
                    </select>

                    {selectedExamId && (
                        <select
                            value={selectedPair ? `${selectedPair.en_session_id}|${selectedPair.hi_session_id}` : ''}
                            onChange={e => handlePaperChange(e.target.value)}
                            disabled={loadingPapers}
                            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm min-w-[300px] max-w-xl disabled:opacity-50"
                        >
                            <option value="">{loadingPapers ? 'Loading...' : `Select Paper Pair (${papers.length})...`}</option>
                            {papers.map(p => (
                                <option key={`${p.en_session_id}|${p.hi_session_id}`} value={`${p.en_session_id}|${p.hi_session_id}`}>
                                    {p.en_label} — {p.linked_count} linked, EN {p.en_solved}/{p.en_total} HI {p.hi_solved}/{p.hi_total}
                                </option>
                            ))}
                        </select>
                    )}

                    {selectedPair && questions.length > 0 && (
                        <>
                            <span className="text-xs text-gray-500">
                                {bothSolvedCount}/{questions.length} both solved
                                {mismatchCount > 0 && <span className="text-red-600 ml-1">({mismatchCount} mismatches)</span>}
                            </span>
                            <div className="flex gap-1 flex-shrink-0">
                                {[
                                    { key: 'all', label: 'All' },
                                    { key: 'both_solved', label: 'Both Solved' },
                                    { key: 'unsolved', label: 'Unsolved' },
                                    { key: 'mismatch', label: 'Mismatches' },
                                ].map(f => (
                                    <button key={f.key} onClick={() => setFilter(f.key)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${filter === f.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    {feedback && (
                        <span className={`text-sm px-3 py-1.5 rounded font-medium ${feedback.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                            {feedback.msg}
                        </span>
                    )}
                </div>
            </div>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar: Section-wise question grid */}
                {selectedPair && questions.length > 0 && (
                    <aside className="w-56 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto p-3">
                        <div className="space-y-4">
                            {Object.entries(groupedQuestions).map(([section, qs]) => {
                                const bothCount = qs.filter(q => q.en?.solution_status === 'DONE' && q.hi?.solution_status === 'DONE').length;
                                return (
                                    <div key={section}>
                                        <div className="flex justify-between items-center mb-2">
                                            <h4 className="text-xs font-bold text-gray-700 truncate" title={section}>{section}</h4>
                                            <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{bothCount}/{qs.length}</span>
                                        </div>
                                        <div className="grid grid-cols-4 gap-1.5">
                                            {qs.map(q => {
                                                const enDone = q.en?.solution_status === 'DONE';
                                                const hiDone = q.hi?.solution_status === 'DONE';
                                                const bothDone = enDone && hiDone;
                                                const mismatch = q.en?.correct && q.hi?.correct && q.en.correct !== q.hi.correct;
                                                const qLabel = q.en?.q_no ? q.en.q_no.replace(/Q\.\s*/, '').trim() : '?';

                                                let colorClass;
                                                if (mismatch) colorClass = 'text-white bg-red-600 border-red-700';
                                                else if (bothDone) colorClass = 'text-gray-600 bg-green-50 border-green-200 hover:bg-green-100';
                                                else if (enDone || hiDone) colorClass = 'text-amber-700 bg-amber-50 border-amber-300 hover:bg-amber-100';
                                                else colorClass = 'text-red-700 bg-red-50 border-red-300 hover:bg-red-100';

                                                return (
                                                    <a key={q.link_id}
                                                        href={`#bp-${q.link_id}`}
                                                        onClick={e => {
                                                            e.preventDefault();
                                                            document.getElementById(`bp-${q.link_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                        }}
                                                        className={`flex items-center justify-center aspect-square text-xs font-medium rounded border transition-colors ${colorClass}`}
                                                        title={`Q.${qLabel} EN:${enDone ? 'DONE' : 'PENDING'} HI:${hiDone ? 'DONE' : 'PENDING'}${mismatch ? ' MISMATCH!' : ''}`}
                                                    >
                                                        {qLabel}
                                                    </a>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </aside>
                )}

                {/* Main Content */}
                <main className="flex-1 overflow-y-auto bg-gray-50">
                    {!selectedExamId ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <h2 className="text-xl font-semibold text-gray-700">Select an exam</h2>
                                <p className="text-gray-400 mt-2 text-sm">Choose an exam and paper pair to review bilingual solutions.</p>
                            </div>
                        </div>
                    ) : !selectedPair ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <h2 className="text-xl font-semibold text-gray-700">Select a paper pair</h2>
                                <p className="text-gray-400 mt-2 text-sm">
                                    {loadingPapers ? 'Loading...' : `${papers.length} paper pairs with 90%+ solutions`}
                                </p>
                            </div>
                        </div>
                    ) : loadingQuestions ? (
                        <div className="flex items-center justify-center py-24">
                            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
                            <span className="ml-3 text-gray-500">Loading bilingual questions...</span>
                        </div>
                    ) : filteredQuestions.length === 0 ? (
                        <div className="text-center py-24 text-gray-400">
                            {filter === 'mismatch' ? 'No answer mismatches found.' : filter === 'unsolved' ? 'All pairs have solutions!' : 'No linked questions found.'}
                        </div>
                    ) : (
                        <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
                            {filteredQuestions.map((q, idx) => (
                                <div key={q.link_id} id={`bp-${q.link_id}`}>
                                    <BilingualCard pair={q} idx={idx} />
                                </div>
                            ))}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
