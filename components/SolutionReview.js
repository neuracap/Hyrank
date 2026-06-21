'use client';

import { useState, useEffect, lazy, Suspense } from 'react';
import Latex from '@/components/Latex';
import { checkQuestionQuality, hasQuestionError } from '@/lib/question-checks';
const FigureEditor = lazy(() => import('@/components/FigureEditor'));

const DIFFICULTY_MAP = {
    1: { label: 'Easy', cls: 'bg-green-100 text-green-700' },
    2: { label: 'Medium', cls: 'bg-yellow-100 text-yellow-700' },
    3: { label: 'Hard', cls: 'bg-red-100 text-red-700' },
};

// Format text by adding line breaks after sentences. English: after ". " before
// an uppercase letter, but never inside $LaTeX$ or [section_tags]. Hindi: after "।".
function formatSentences(text) {
    if (!text) return text;
    const latexBlocks = [];
    let p = text.replace(/\$[^$]+\$/g, (m) => { latexBlocks.push(m); return `__LATEX_${latexBlocks.length - 1}__`; });
    const secTags = [];
    p = p.replace(/\[[a-z_]+\]/g, (m) => { secTags.push(m); return `__SEC_${secTags.length - 1}__`; });
    p = p.replace(/\.(\s+)(?=[A-Zऀ-ॿ])/g, '.\n');
    p = p.replace(/।\s*/g, '।\n');
    p = p.replace(/\n{3,}/g, '\n\n');
    for (let i = 0; i < latexBlocks.length; i++) p = p.replace(`__LATEX_${i}__`, latexBlocks[i]);
    for (let i = 0; i < secTags.length; i++) p = p.replace(`__SEC_${i}__`, secTags[i]);
    return p;
}

function toArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') return [val];
    return [];
}

// Flatten a display_sections array into editable [section_key] text.
function sectionsToText(sections) {
    if (Array.isArray(sections)) {
        return sections.map(s => {
            const prefix = s.key ? `[${s.key}] ` : '';
            const content = (s.content || '').replace(/\\n/g, '\n');
            return prefix + content;
        }).join('\n\n');
    }
    if (sections && typeof sections === 'object') {
        return Object.entries(sections).map(([key, val]) => {
            const text = typeof val === 'string' ? val : val?.approach || val?.content || '';
            return `[${key}] ${(text || '').replace(/\\n/g, '\n')}`;
        }).join('\n\n');
    }
    return '';
}

// Parse the edited text back into display_sections.
function textToSections(text) {
    if (!text || !text.trim()) return [];
    const parts = text.split(/^(?=\[[a-z_]+\]\s)/m).filter(b => b.trim());
    return parts.map(part => {
        const match = part.match(/^\[([a-z_]+)\]\s*([\s\S]*)$/);
        if (match) return { key: match[1], content: match[2].trim() };
        return { key: 'exam_craft', content: part.trim() };
    });
}

function DifficultyBadge({ level }) {
    if (!level) return null;
    const d = DIFFICULTY_MAP[level];
    if (!d) return <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{level}</span>;
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${d.cls}`}>{d.label}</span>;
}

function CollapsibleSection({ title, defaultOpen = false, children, badge }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border-t border-gray-100">
            <button onClick={() => setOpen(!open)} className="w-full px-4 py-2 flex items-center justify-between text-left hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{title}</span>
                    {badge}
                </div>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && <div className="px-4 pb-3">{children}</div>}
        </div>
    );
}

export default function SolutionReview({ exams = [], paperId: propPaperId, language: propLanguage }) {
    const [selectedExamId, setSelectedExamId] = useState('');
    const [selectedLanguage, setSelectedLanguage] = useState(propLanguage || 'EN');
    const [papers, setPapers] = useState([]);
    const [loadingPapers, setLoadingPapers] = useState(false);
    const [selectedPaper, setSelectedPaper] = useState(
        propPaperId ? { paper_session_id: propPaperId } : null
    );
    const [questions, setQuestions] = useState([]);
    const [loadingQuestions, setLoadingQuestions] = useState(!!propPaperId);
    const [feedback, setFeedback] = useState(null);
    const [filter, setFilter] = useState('all');
    const [advancing, setAdvancing] = useState(false);

    const handleAdvanceStatus = async (nextStatus) => {
        if (!selectedPaper) return;
        if (!confirm(`Move this paper to ${nextStatus}?`)) return;
        setAdvancing(true);
        try {
            const res = await fetch('/api/paper/advance-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paper_session_id: selectedPaper.paper_session_id, next_status: nextStatus }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', message: `Moved to ${nextStatus}` });
                setTimeout(() => setFeedback(null), 3000);
            } else {
                setFeedback({ type: 'error', message: data.error || 'Failed' });
            }
        } catch (e) {
            setFeedback({ type: 'error', message: e.message });
        } finally {
            setAdvancing(false);
        }
    };

    const fetchPapers = async (examId, language) => {
        if (!examId) { setPapers([]); return; }
        setLoadingPapers(true);
        setSelectedPaper(null);
        setQuestions([]);
        setFeedback(null);
        try {
            const res = await fetch(`/api/solution-review/papers?exam_id=${examId}&language=${language}`);
            const data = await res.json();
            setPapers(res.ok ? (data.papers || []) : []);
        } catch { setPapers([]); }
        finally { setLoadingPapers(false); }
    };

    const handleExamChange = (examId) => {
        setSelectedExamId(examId);
        fetchPapers(examId, selectedLanguage);
    };

    const handleLanguageChange = (lang) => {
        setSelectedLanguage(lang);
        if (selectedExamId) fetchPapers(selectedExamId, lang);
    };

    const handlePaperChange = async (paperId) => {
        const paper = papers.find(p => p.paper_session_id === paperId);
        if (!paper) return;
        setSelectedPaper(paper);
        setQuestions([]);
        setFeedback(null);
        setFilter('all');
        setLoadingQuestions(true);

        try {
            const res = await fetch(`/api/solution-review/questions?paperId=${paper.paper_session_id}&language=${selectedLanguage}`);
            const data = await res.json();
            if (res.ok && data.questions) {
                setQuestions(data.questions);
            } else {
                setFeedback({ type: 'error', message: data.error || 'Failed to load questions.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error loading questions.' });
        } finally {
            setLoadingQuestions(false);
        }
    };

    useEffect(() => {
        if (propPaperId) {
            setSelectedPaper({ paper_session_id: propPaperId });
            setLoadingQuestions(true);
            fetch(`/api/solution-review/questions?paperId=${propPaperId}&language=${propLanguage || 'EN'}`)
                .then(r => r.json())
                .then(data => { if (data.questions) setQuestions(data.questions); })
                .catch(err => setFeedback({ type: 'error', message: err.message }))
                .finally(() => setLoadingQuestions(false));
        }
    }, [propPaperId, propLanguage]);

    const filteredQuestions = questions.filter(q => {
        if (filter === 'solved') return q.solution_status === 'DONE';
        if (filter === 'unsolved') return q.solution_status !== 'DONE';
        if (filter === 'figures') return !!(q.solution_figure_prompt || q.solution_figure_helpful);
        return true;
    });

    const solvedCount = questions.filter(q => q.solution_status === 'DONE').length;

    const handleDifficultyChange = async (questionId, versionNo, newDifficulty) => {
        setQuestions(prev => prev.map(q =>
            q.question_id === questionId ? { ...q, difficulty: newDifficulty } : q
        ));
        try {
            const q = questions.find(q => q.question_id === questionId);
            await fetch('/api/question/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: questionId,
                    version_no: versionNo || 1,
                    language: selectedLanguage,
                    question_text: q?.question_text || '',
                    difficulty: newDifficulty,
                }),
            });
        } catch (e) {
            console.error('Difficulty update error:', e);
        }
    };

    const groupedQuestions = questions.reduce((acc, q) => {
        const section = q.section_code || 'Other';
        if (!acc[section]) acc[section] = [];
        acc[section].push(q);
        return acc;
    }, {});

    const sectionStats = Object.entries(groupedQuestions).map(([code, qs]) => ({
        code,
        total: qs.length,
        easy: qs.filter(q => q.difficulty === 1).length,
        medium: qs.filter(q => q.difficulty === 2).length,
        hard: qs.filter(q => q.difficulty === 3).length,
        unset: qs.filter(q => !q.difficulty).length,
        solved: qs.filter(q => q.solution_status === 'DONE').length,
    }));

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-white">
            {/* Top Bar — Row 1: Selectors */}
            <div className="flex-shrink-0 bg-white border-b border-gray-200 shadow-sm px-4 py-2 space-y-2">
                <div className="flex items-center gap-3">
                    {propPaperId && (
                        <a href="/solution-review" className="text-sm text-blue-600 hover:text-blue-800 font-medium flex-shrink-0">&larr; Back</a>
                    )}
                    <h1 className="text-lg font-bold text-gray-900 flex-shrink-0">Solution Review</h1>

                    {!propPaperId && (
                        <>
                            <select value={selectedExamId} onChange={e => handleExamChange(e.target.value)}
                                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm min-w-[200px]">
                                <option value="">Select Exam...</option>
                                {exams.map(e => (
                                    <option key={e.exam_id} value={e.exam_id}>{e.name}</option>
                                ))}
                            </select>

                            {selectedExamId && (
                                <div className="flex gap-1">
                                    {['EN', 'HI'].map(lang => (
                                        <button key={lang} onClick={() => handleLanguageChange(lang)}
                                            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${selectedLanguage === lang ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                            {lang === 'EN' ? 'English' : 'Hindi'}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {!propPaperId && selectedExamId && (() => {
                        const pendingPapers = papers.filter(p => !['SOLUTION_REVIEW', 'PRODUCTION'].includes(p.status));
                        const reviewedPapers = papers.filter(p => ['SOLUTION_REVIEW', 'PRODUCTION'].includes(p.status));
                        return (
                            <select
                                value={selectedPaper?.paper_session_id || ''}
                                onChange={e => e.target.value && handlePaperChange(e.target.value)}
                                disabled={loadingPapers}
                                className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm min-w-[280px] disabled:opacity-50"
                            >
                                <option value="">{loadingPapers ? 'Loading papers...' : `Select Paper (${papers.length})...`}</option>
                                {pendingPapers.length > 0 && (
                                    <optgroup label={`To Review (${pendingPapers.length})`}>
                                        {pendingPapers.map(p => (
                                            <option key={p.paper_session_id} value={p.paper_session_id}>
                                                {p.session_label} — {parseInt(p.solved_count || 0)}/{parseInt(p.question_count || 0)} solved [{p.status}]
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                {reviewedPapers.length > 0 && (
                                    <optgroup label={`Reviewed / Production (${reviewedPapers.length})`}>
                                        {reviewedPapers.map(p => (
                                            <option key={p.paper_session_id} value={p.paper_session_id}>
                                                {p.session_label} — {parseInt(p.solved_count || 0)}/{parseInt(p.question_count || 0)} solved [{p.status}]
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                            </select>
                        );
                    })()}

                    {feedback && (
                        <span className={`text-xs px-2.5 py-1 rounded font-medium flex-shrink-0 ${feedback.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                            {feedback.message}
                        </span>
                    )}
                </div>

                {/* Row 2: Stats + PDF link + Filters + Actions */}
                {selectedPaper && questions.length > 0 && (
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">
                            {solvedCount}/{questions.length} solved
                        </span>
                        {selectedPaper.source_pdf_path && (
                            <a href={`/api/pdf?path=${encodeURIComponent(selectedPaper.source_pdf_path)}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs text-red-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-0.5 rounded">
                                Source PDF
                            </a>
                        )}
                        <a href={`/test?testId=${selectedPaper.paper_session_id}&locked=true`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-0.5 rounded">
                            Edit Paper
                        </a>
                        <div className="flex gap-1">
                            {[
                                { key: 'all', label: 'All' },
                                { key: 'solved', label: 'Solved' },
                                { key: 'unsolved', label: 'Unsolved' },
                                { key: 'figures', label: `Figures (${questions.filter(q => q.solution_figure_prompt || q.solution_figure_helpful).length})` },
                            ].map(f => (
                                <button key={f.key} onClick={() => setFilter(f.key)}
                                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${filter === f.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-1.5 ml-auto">
                            <button onClick={() => handleAdvanceStatus('SOLUTION_REVIEW')} disabled={advancing}
                                className="px-3 py-1 text-xs font-semibold bg-amber-500 text-white rounded-md hover:bg-amber-600 disabled:opacity-50">
                                {advancing ? '...' : 'Mark Solution Reviewed'}
                            </button>
                            <button onClick={() => handleAdvanceStatus('PRODUCTION')} disabled={advancing}
                                className="px-3 py-1 text-xs font-semibold bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50">
                                {advancing ? '...' : 'Move to Production'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Row 3: Section-wise difficulty table */}
                {selectedPaper && sectionStats.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="text-gray-500 uppercase">
                                    <th className="text-left font-semibold px-2 py-1">Section</th>
                                    <th className="text-center font-semibold px-2 py-1">Total</th>
                                    <th className="text-center font-semibold px-2 py-1 text-green-700">Easy</th>
                                    <th className="text-center font-semibold px-2 py-1 text-yellow-700">Medium</th>
                                    <th className="text-center font-semibold px-2 py-1 text-red-700">Hard</th>
                                    <th className="text-center font-semibold px-2 py-1 text-gray-400">Unset</th>
                                    <th className="text-center font-semibold px-2 py-1">Solved</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sectionStats.map(s => (
                                    <tr key={s.code} className="border-t border-gray-100">
                                        <td className="px-2 py-1 font-semibold text-gray-700">{s.code}</td>
                                        <td className="text-center px-2 py-1">{s.total}</td>
                                        <td className="text-center px-2 py-1"><span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">{s.easy}</span></td>
                                        <td className="text-center px-2 py-1"><span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-bold">{s.medium}</span></td>
                                        <td className="text-center px-2 py-1"><span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">{s.hard}</span></td>
                                        <td className="text-center px-2 py-1"><span className="text-gray-400">{s.unset || '-'}</span></td>
                                        <td className="text-center px-2 py-1">{s.solved}/{s.total}</td>
                                    </tr>
                                ))}
                                {sectionStats.length > 1 && (
                                    <tr className="border-t border-gray-300 font-bold">
                                        <td className="px-2 py-1 text-gray-700">Total</td>
                                        <td className="text-center px-2 py-1">{questions.length}</td>
                                        <td className="text-center px-2 py-1"><span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{sectionStats.reduce((s, r) => s + r.easy, 0)}</span></td>
                                        <td className="text-center px-2 py-1"><span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">{sectionStats.reduce((s, r) => s + r.medium, 0)}</span></td>
                                        <td className="text-center px-2 py-1"><span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{sectionStats.reduce((s, r) => s + r.hard, 0)}</span></td>
                                        <td className="text-center px-2 py-1 text-gray-400">{sectionStats.reduce((s, r) => s + r.unset, 0) || '-'}</td>
                                        <td className="text-center px-2 py-1">{solvedCount}/{questions.length}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Body: Sidebar + Main */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar: Section-wise question grid */}
                {selectedPaper && questions.length > 0 && (
                    <aside className="w-56 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto p-3">
                        <div className="space-y-4">
                            {Object.entries(groupedQuestions).map(([section, qs]) => {
                                const sectionSolved = qs.filter(q => q.solution_status === 'DONE').length;
                                return (
                                    <div key={section}>
                                        <div className="flex justify-between items-center mb-2">
                                            <h4 className="text-xs font-bold text-gray-700 truncate" title={section}>{section}</h4>
                                            <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                                                {sectionSolved}/{qs.length}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-4 gap-1.5">
                                            {qs.map(q => {
                                                const hasSolution = q.solution_status === 'DONE';
                                                const qLabel = q.source_q_no ? q.source_q_no.replace(/Q\.\s*/, '').trim() : '?';
                                                const hasQIssue = hasQuestionError(q.question_text, q.options?.map(o => ({ ...o, option_key: o.opt_label })), q.correct_option_label);
                                                let colorClass;
                                                if (hasQIssue) colorClass = 'text-white bg-pink-600 border-pink-700 ring-1 ring-pink-400';
                                                else if (hasSolution) colorClass = 'text-gray-600 bg-green-50 border-green-200 hover:bg-green-100';
                                                else colorClass = 'text-red-700 bg-red-50 border-red-300 hover:bg-red-100';
                                                return (
                                                    <a
                                                        key={q.question_id}
                                                        href={`#sq-${q.question_id}`}
                                                        onClick={e => {
                                                            e.preventDefault();
                                                            const el = document.getElementById(`sq-${q.question_id}`);
                                                            if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
                                                        }}
                                                        className={`flex items-center justify-center aspect-square text-xs font-medium rounded border transition-colors ${colorClass}`}
                                                        title={`Q.${qLabel} — ${hasSolution ? 'DONE' : q.solution_status || 'PENDING'}${hasQIssue ? ' ⚠ QUALITY ISSUE' : ''}`}
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
                    {(!selectedExamId && !propPaperId) ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <h2 className="text-xl font-semibold text-gray-700">Select an exam to start</h2>
                                <p className="text-gray-400 mt-2 text-sm">Choose an exam, language, then paper from the dropdowns above.</p>
                            </div>
                        </div>
                    ) : !selectedPaper ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <h2 className="text-xl font-semibold text-gray-700">Select a paper to review solutions</h2>
                                <p className="text-gray-400 mt-2 text-sm">
                                    {loadingPapers ? 'Loading papers...' : `${papers.length} papers available`}
                                </p>
                            </div>
                        </div>
                    ) : loadingQuestions ? (
                        <div className="flex items-center justify-center py-24">
                            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
                            <span className="ml-3 text-gray-500">Loading questions...</span>
                        </div>
                    ) : filteredQuestions.length === 0 ? (
                        <div className="text-center py-24 text-gray-400">
                            {filter === 'unsolved' ? 'All questions have solutions!' : 'No questions found.'}
                        </div>
                    ) : (
                        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
                            {filteredQuestions.map((q, idx) => (
                                <div key={q.question_id} id={`sq-${q.question_id}`}>
                                    <QuestionCard
                                        q={q}
                                        idx={idx}
                                        paperId={selectedPaper.paper_session_id}
                                        language={selectedLanguage}
                                        onDifficultyChange={(newDiff) => handleDifficultyChange(q.question_id, q.version_no, newDiff)}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

// =========================================================
// Single-language question card — mirrors the bilingual editor's
// EditablePanel style: Edit Q (stem + options with paste-image),
// A/B/C/D correct selector, Core Answer Basis textarea, sectioned
// solution editor with [section_key] preview, figure attach/edit.
// =========================================================
function QuestionCard({ q, idx, paperId, language, onDifficultyChange }) {
    const hasSolution = q.solution_status === 'DONE';
    const sj = q.solution_json || {};
    const answer = q.correct_option_label || q.answer_label || sj.answer_outcome?.correct_option;
    const finalAnswerText = q.final_answer_text || sj.answer_outcome?.final_answer_text;
    const coreBasis = sj.answer_outcome?.core_answer_basis;
    const displaySections = sj.display_sections;
    const diagnosticSignals = sj.diagnostic_signals;
    const learningSignals = sj.learning_signals;
    const studentHooks = sj.student_diagnostic_hooks;
    const qualityCheck = sj.quality_check;
    const indexingMeta = sj.indexing_metadata;
    const figurePrompt = q.solution_figure_prompt || sj.answer_outcome?.figure_prompt;
    const figureHelpful = q.solution_figure_helpful || sj.answer_outcome?.figure_helpful;

    const [editingQuestion, setEditingQuestion] = useState(false);
    const [bodyText, setBodyText] = useState(q.question_text || '');
    const [optionEdits, setOptionEdits] = useState({}); // { A: 'text', ... } — only keys that were edited

    const [explanationText, setExplanationText] = useState(() => sectionsToText(displaySections));
    const [coreBasisText, setCoreBasisText] = useState(coreBasis || '');
    const [correctLabel, setCorrectLabel] = useState(answer || '');
    const [showPreview, setShowPreview] = useState(true);

    const [isSaving, setIsSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState(null);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [uploadErr, setUploadErr] = useState(null);
    const [mockWorthiness, setMockWorthiness] = useState(q.mock_worthiness || null);

    const [figureUrl, setFigureUrl] = useState(sj.answer_outcome?.figure_url || '');
    const [uploadingFigure, setUploadingFigure] = useState(false);
    const [figureNeeded, setFigureNeeded] = useState(!!(figureHelpful || figurePrompt));
    const [editingFigure, setEditingFigure] = useState(false);
    const [dismissingFigure, setDismissingFigure] = useState(false);

    const optionKeys = ['A', 'B', 'C', 'D'];
    const existingOptByKey = Object.fromEntries((q.options || []).map(o => [o.opt_label, o]));
    const draftOptionFor = (k) => {
        if (Object.prototype.hasOwnProperty.call(optionEdits, k)) return optionEdits[k];
        return existingOptByKey[k]?.opt_text || '';
    };
    const setDraftOption = (k, value) => setOptionEdits(prev => ({ ...prev, [k]: value }));

    // Paste-to-upload for stem/option/solution textareas — mirrors the
    // bilingual editor. Inserts `![](url)` markdown at the cursor.
    const handleImagePaste = async (e, currentValue, setNewValue, optionKey, roleOverride) => {
        const items = Array.from(e.clipboardData?.items || []);
        const imgItem = items.find(it => it.type && it.type.startsWith('image/'));
        if (!imgItem) return;
        e.preventDefault();
        const el = e.target;
        const start = (typeof el.selectionStart === 'number') ? el.selectionStart : currentValue.length;
        const end   = (typeof el.selectionEnd   === 'number') ? el.selectionEnd   : currentValue.length;
        let file = imgItem.getAsFile();
        if ((!file || file.size === 0) && e.clipboardData?.files?.length) {
            file = e.clipboardData.files[0];
        }
        if (!file) return;
        if (file.size === 0) {
            setUploadErr('Image upload failed: clipboard image is empty (0 bytes). Try copying the image again, or use a screenshot snip (Win+Shift+S).');
            return;
        }
        setUploadingImage(true);
        setUploadErr(null);
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Could not read image'));
                reader.readAsDataURL(file);
            });
            const body = {
                data: dataUrl,
                question_id: q.question_id,
                version_no: q.version_no || 1,
                language,
                role: roleOverride || (optionKey ? 'option' : 'stem'),
            };
            if (optionKey) body.option_key = optionKey;
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const json = await res.json();
            const url = json.latexPath || json.secure_url || json.url;
            if (!res.ok || !url) throw new Error(json.error || 'Upload failed');
            const markdown = `![](${url})`;
            setNewValue(currentValue.slice(0, start) + markdown + currentValue.slice(end));
        } catch (err) {
            setUploadErr('Image upload failed: ' + err.message);
        } finally {
            setUploadingImage(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        setSaveMsg(null);
        try {
            const updatedSj = { ...sj };
            updatedSj.display_sections = textToSections(explanationText);
            if (!updatedSj.answer_outcome) updatedSj.answer_outcome = {};
            updatedSj.answer_outcome.core_answer_basis = coreBasisText;
            if (figureUrl) updatedSj.answer_outcome.figure_url = figureUrl;

            const payload = {
                question_id: q.question_id,
                version_no: q.version_no,
                language,
                correct_option_label: correctLabel || '',
                full_json: updatedSj,
                difficulty: q.difficulty || '',
                mock_worthiness: mockWorthiness,
            };

            // Include body_text only if it actually changed.
            if (bodyText !== (q.question_text || '')) {
                payload.body_text = bodyText;
            }
            // Include only options that changed.
            const optsArr = [];
            for (const k of Object.keys(optionEdits)) {
                const next = optionEdits[k];
                const prev = existingOptByKey[k]?.opt_text || '';
                if (next !== prev) optsArr.push({ option_key: k, opt_text: next });
            }
            if (optsArr.length > 0) payload.options = optsArr;

            const res = await fetch('/api/solution-review/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paper_session_id: paperId, solutions: [payload] }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setSaveMsg('Saved!');
                setTimeout(() => setSaveMsg(null), 2500);
            } else {
                setSaveMsg('Error: ' + (data.error || 'Failed'));
            }
        } catch (err) {
            console.error(err);
            setSaveMsg('Network error');
        } finally {
            setIsSaving(false);
        }
    };

    // Save figure URL right after upload so a refresh keeps the image.
    const autoSaveFigure = (url) => {
        const updatedSj = { ...sj };
        if (!updatedSj.answer_outcome) updatedSj.answer_outcome = {};
        updatedSj.answer_outcome.figure_url = url;
        return fetch('/api/solution-review/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                paper_session_id: paperId,
                solutions: [{
                    question_id: q.question_id,
                    version_no: q.version_no,
                    language,
                    full_json: updatedSj,
                }],
            }),
        }).catch(e => console.error('Auto-save figure error:', e));
    };

    return (
        <div className={`bg-white rounded-lg border shadow-sm overflow-hidden ${hasSolution ? 'border-green-300' : 'border-gray-200'}`}>
            {/* Header */}
            <div className={`px-5 py-3 border-b flex items-center justify-between ${hasSolution ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-gray-700">Q.{q.source_q_no || idx + 1}</span>
                    <span className="text-xs text-gray-400 font-mono">{(q.question_id || '').slice(0, 8)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${hasSolution ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {hasSolution ? 'DONE' : q.solution_status || 'PENDING'}
                    </span>
                    <div className="flex gap-0.5">
                        {[{ val: 1, label: 'E', cls: 'bg-green-100 text-green-700 border-green-300', active: 'bg-green-600 text-white border-green-600' },
                          { val: 2, label: 'M', cls: 'bg-yellow-100 text-yellow-700 border-yellow-300', active: 'bg-yellow-500 text-white border-yellow-500' },
                          { val: 3, label: 'H', cls: 'bg-red-100 text-red-700 border-red-300', active: 'bg-red-600 text-white border-red-600' },
                        ].map(d => (
                            <button key={d.val} onClick={() => onDifficultyChange && onDifficultyChange(d.val)}
                                className={`w-5 h-5 text-[10px] font-bold rounded border ${q.difficulty === d.val ? d.active : d.cls} transition-colors`}
                                title={d.val === 1 ? 'Easy' : d.val === 2 ? 'Medium' : 'Hard'}>
                                {d.label}
                            </button>
                        ))}
                    </div>
                    {q.subtype && <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{q.subtype}</span>}
                    {q.section_code && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{q.section_code}</span>}
                </div>
                <div className="flex items-center gap-2">
                    {correctLabel && (
                        <span className="text-sm font-bold text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full">Ans: {correctLabel}</span>
                    )}
                    <button
                        type="button"
                        onClick={() => setEditingQuestion(v => !v)}
                        className={`px-2 py-1 rounded border text-xs font-semibold ${editingQuestion ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50'}`}
                        title="Edit question stem and options"
                    >
                        {editingQuestion ? 'Done Editing Q' : 'Edit Q'}
                    </button>
                </div>
            </div>

            {/* Question + Options — read or edit mode */}
            <div className="px-5 py-3 border-b border-gray-100">
                {!editingQuestion ? (
                    <>
                        <div className="text-sm text-gray-800"><Latex>{bodyText || '(No question text)'}</Latex></div>
                        <div className="grid grid-cols-2 gap-3 mt-3">
                            {optionKeys.map(k => {
                                const text = draftOptionFor(k);
                                const isCorrect = correctLabel === k;
                                const isBlank = !text || !text.trim();
                                return (
                                    <div key={k}
                                        className={`flex gap-2 items-start p-3 rounded-md border ${isBlank ? 'bg-red-50 border-red-300' : isCorrect ? 'bg-green-50 border-green-400' : 'bg-white border-gray-200'}`}>
                                        <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${isCorrect ? 'bg-green-500 text-white border-green-500' : 'bg-gray-100 text-gray-600 border-gray-300'}`}>
                                            {k}
                                        </span>
                                        <div className="text-sm text-gray-700 pt-0.5 flex-1">
                                            {isBlank ? <span className="text-red-500 italic font-semibold">BLANK</span> : <Latex>{text}</Latex>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                ) : (
                    <div className="space-y-2">
                        <div>
                            <div className="flex items-center justify-between mb-0.5">
                                <label className="text-[10px] font-bold text-gray-500 uppercase">Stem</label>
                                <span className="text-[10px] text-gray-400">paste image (Ctrl+V) supported</span>
                            </div>
                            <textarea
                                value={bodyText}
                                onChange={e => setBodyText(e.target.value)}
                                onPaste={e => handleImagePaste(e, bodyText, setBodyText)}
                                rows={Math.max(2, Math.min(10, Math.ceil((bodyText.length || 0) / 80)))}
                                className="w-full border border-blue-300 rounded px-2 py-1 text-sm font-mono focus:ring-2 focus:ring-blue-400"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {optionKeys.map(k => (
                                <label key={k} className="block">
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">Option {k}</span>
                                    <input
                                        type="text"
                                        value={draftOptionFor(k)}
                                        onChange={e => setDraftOption(k, e.target.value)}
                                        onPaste={e => handleImagePaste(e, draftOptionFor(k), (next) => setDraftOption(k, next), k)}
                                        className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono"
                                    />
                                </label>
                            ))}
                        </div>
                        {uploadingImage && (
                            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                Uploading image…
                            </div>
                        )}
                        {uploadErr && (
                            <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                                {uploadErr}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Quality warnings */}
            {(() => {
                const issues = checkQuestionQuality(bodyText, q.options?.map(o => ({ ...o, option_key: o.opt_label })), correctLabel);
                if (issues.length === 0) return null;
                return (
                    <div className="px-5 py-2 border-b border-pink-200 bg-pink-50">
                        {issues.map((w, i) => (
                            <div key={i} className={`flex items-center gap-1.5 text-xs ${w.severity === 'error' ? 'text-red-700 font-semibold' : 'text-orange-700'}`}>
                                <span>{w.severity === 'error' ? '⛔' : '⚠️'}</span> {w.message}
                            </div>
                        ))}
                    </div>
                );
            })()}

            {/* Correct answer selector — always editable */}
            <div className="px-5 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                <span className="text-xs text-gray-500 font-semibold uppercase">Correct:</span>
                {optionKeys.map(opt => (
                    <button key={opt} onClick={() => setCorrectLabel(opt)}
                        className={`w-7 h-7 text-xs font-bold rounded border ${correctLabel === opt ? 'bg-green-500 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'}`}>
                        {opt}
                    </button>
                ))}
                {finalAnswerText && (
                    <span className="text-xs text-gray-500 ml-3">
                        Final: <Latex>{finalAnswerText}</Latex>
                    </span>
                )}
            </div>

            {/* Core Answer Basis — auto-grow */}
            <div className="px-5 py-2 border-b border-gray-100 bg-blue-50">
                <label className="text-[10px] text-gray-500 uppercase font-semibold block mb-0.5">Core Answer Basis</label>
                <textarea
                    value={coreBasisText}
                    onChange={e => setCoreBasisText(e.target.value)}
                    rows={Math.max(1, Math.ceil((coreBasisText.length || 0) / 90) || 1)}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-400 resize-y"
                    placeholder="One-line reason why this is the correct answer..."
                />
            </div>

            {/* Action row */}
            <div className="px-5 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2 flex-wrap">
                <button onClick={() => setExplanationText(formatSentences(explanationText))}
                    className="px-2 py-1 text-xs font-semibold bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    title="Add line breaks after sentences (. and ।)">
                    Format
                </button>
                <div className="flex gap-0.5 border border-gray-300 rounded overflow-hidden">
                    {[{ val: 'ANCHOR', label: 'A', color: 'bg-green-600 text-white', title: 'Anchor — must include in mock' },
                      { val: 'ADAPTABLE', label: 'Ad', color: 'bg-blue-500 text-white', title: 'Adaptable — can include' },
                      { val: 'REJECT', label: 'R', color: 'bg-red-500 text-white', title: 'Reject — not mock worthy' },
                    ].map(w => (
                        <button key={w.val} onClick={() => setMockWorthiness(mockWorthiness === w.val ? null : w.val)}
                            className={`px-1.5 py-1 text-[10px] font-bold transition-colors ${mockWorthiness === w.val ? w.color : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                            title={w.title}>
                            {w.label}
                        </button>
                    ))}
                </div>
                <button onClick={() => setShowPreview(p => !p)}
                    className="px-2 py-1 text-xs font-semibold bg-white text-gray-600 border border-gray-300 rounded hover:bg-gray-50">
                    {showPreview ? 'Hide Preview' : 'Show Preview'}
                </button>
                {saveMsg && (
                    <span className={`text-xs font-semibold ml-auto ${saveMsg === 'Saved!' ? 'text-green-600' : 'text-red-600'}`}>
                        {saveMsg}
                    </span>
                )}
                <button onClick={handleSave} disabled={isSaving}
                    className={`px-3 py-1 text-xs font-semibold rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 ${saveMsg ? '' : 'ml-auto'}`}>
                    {isSaving ? 'Saving...' : 'Save'}
                </button>
            </div>

            {/* Sectioned solution editor */}
            <div className="px-5 py-3 border-b border-gray-100">
                <div className="text-[10px] text-gray-400 mb-1">paste image (Ctrl+V) supported</div>
                <textarea
                    value={explanationText}
                    onChange={e => setExplanationText(e.target.value)}
                    onPaste={e => handleImagePaste(e, explanationText, setExplanationText, null, 'solution_body')}
                    rows={8}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                    placeholder="[exam_craft] Solution text here...&#10;&#10;[toppers_insight] One-liner..."
                />
                {uploadingImage && (
                    <div className="mt-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        Uploading image…
                    </div>
                )}
                {uploadErr && (
                    <div className="mt-1 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                        {uploadErr}
                    </div>
                )}

                {showPreview && explanationText && (
                    <div className="mt-2 p-3 bg-gray-50 rounded border border-gray-200 text-sm space-y-2">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Preview</p>
                        {textToSections(explanationText).map((sec, i) => (
                            <div key={i}>
                                <div className="font-bold text-gray-600 uppercase text-[11px] mb-0.5">{(sec.key || '').replace(/_/g, ' ')}</div>
                                {(sec.content || '').replace(/\\n/g, '\n').split('\n').map((line, li) => (
                                    <div key={li} className={line.trim() ? '' : 'h-2'}>
                                        {line.trim() ? <Latex>{line}</Latex> : null}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Figure section — always visible (toggleable "not needed") */}
            <div className="px-5 py-3 border-b border-gray-100 bg-amber-50/60">
                <div className="flex items-center gap-2 mb-1">
                    <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Solution Figure</label>
                    {figureNeeded && (
                        <button
                            disabled={dismissingFigure}
                            onClick={async () => {
                                setDismissingFigure(true);
                                try {
                                    const res = await fetch('/api/solution-review/toggle-figure', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ question_id: q.question_id, version_no: q.version_no, language, value: false }),
                                    });
                                    if (res.ok) setFigureNeeded(false);
                                } catch (e) { console.error(e); }
                                finally { setDismissingFigure(false); }
                            }}
                            className="px-2 py-0.5 text-[10px] font-semibold bg-white text-red-600 border border-red-300 rounded hover:bg-red-50 disabled:opacity-50"
                        >
                            {dismissingFigure ? '...' : 'Figure Not Needed'}
                        </button>
                    )}
                </div>
                {figurePrompt && (
                    <div className="text-sm text-gray-700 mb-2">{figurePrompt}</div>
                )}
                {figureUrl ? (
                    <div className="flex items-start gap-2">
                        <div className="relative inline-block">
                            <img src={figureUrl} alt="Solution figure" className="max-h-48 rounded border border-gray-300 object-contain" />
                            <button onClick={() => setFigureUrl('')}
                                className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                                title="Remove figure">x</button>
                        </div>
                        <button onClick={() => setEditingFigure(true)}
                            className="px-2 py-1 text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100">
                            Edit
                        </button>
                    </div>
                ) : (
                    <div
                        className="border-2 border-dashed border-amber-300 rounded-lg p-4 text-center cursor-pointer hover:border-amber-500 hover:bg-amber-100 transition-colors"
                        onPaste={async (e) => {
                            const items = e.clipboardData?.items;
                            if (!items) return;
                            for (let item of items) {
                                if (item.type.startsWith('image/')) {
                                    e.preventDefault();
                                    setUploadingFigure(true);
                                    const fileBlob = item.getAsFile();
                                    const reader = new FileReader();
                                    reader.readAsDataURL(fileBlob);
                                    reader.onloadend = async () => {
                                        try {
                                            const res = await fetch('/api/upload', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    data: reader.result,
                                                    question_id: q.question_id,
                                                    language,
                                                    version_no: q.version_no,
                                                    role: 'solution_figure',
                                                }),
                                            });
                                            const data = await res.json();
                                            const url = data.url || data.secure_url || data.latexPath;
                                            if (url) {
                                                setFigureUrl(url);
                                                autoSaveFigure(url);
                                            } else {
                                                alert('Upload failed: ' + (data.error || 'No URL returned'));
                                            }
                                        } catch (err) {
                                            console.error('Figure upload error:', err);
                                            alert('Upload failed');
                                        } finally {
                                            setUploadingFigure(false);
                                        }
                                    };
                                    break;
                                }
                            }
                        }}
                        tabIndex={0}
                    >
                        {uploadingFigure ? (
                            <span className="text-xs text-amber-700">Uploading...</span>
                        ) : (
                            <span className="text-xs text-amber-600">Paste figure here (Ctrl+V)</span>
                        )}
                    </div>
                )}
            </div>

            {editingFigure && figureUrl && (
                <Suspense fallback={<div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"><span className="text-white">Loading editor...</span></div>}>
                    <FigureEditor
                        imageUrl={figureUrl}
                        onSave={async (blob) => {
                            const reader = new FileReader();
                            reader.readAsDataURL(blob);
                            await new Promise(resolve => { reader.onloadend = resolve; });
                            const res = await fetch('/api/upload', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    data: reader.result,
                                    question_id: q.question_id,
                                    language,
                                    version_no: q.version_no,
                                    role: 'solution_figure',
                                }),
                            });
                            const data = await res.json();
                            const url = data.url || data.secure_url || data.latexPath;
                            if (url) {
                                setFigureUrl(url);
                                autoSaveFigure(url);
                            }
                            setEditingFigure(false);
                        }}
                        onClose={() => setEditingFigure(false)}
                    />
                </Suspense>
            )}

            {/* Read-only structured solution metadata (existing) */}
            {hasSolution && (
                <div>
                    {diagnosticSignals && (
                        <CollapsibleSection title="Diagnostic Signals">
                            {toArray(diagnosticSignals.mistake_patterns).length > 0 && (
                                <div className="mb-2">
                                    <span className="text-xs font-semibold text-gray-500">Mistake Patterns: </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {toArray(diagnosticSignals.mistake_patterns).map((p, i) => (
                                            <span key={i} className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded">{p}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {toArray(diagnosticSignals.exam_skills_tested).length > 0 && (
                                <div className="mb-2">
                                    <span className="text-xs font-semibold text-gray-500">Skills Tested: </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {toArray(diagnosticSignals.exam_skills_tested).map((s, i) => (
                                            <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{s}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {toArray(diagnosticSignals.trap_type).length > 0 && (
                                <div>
                                    <span className="text-xs font-semibold text-gray-500">Traps: </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {toArray(diagnosticSignals.trap_type).map((t, i) => (
                                            <span key={i} className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">{t}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CollapsibleSection>
                    )}
                    {learningSignals && (
                        <CollapsibleSection title="Learning Signals">
                            {toArray(learningSignals.concepts).length > 0 && (
                                <div className="mb-2">
                                    <span className="text-xs font-semibold text-gray-500">Concepts: </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {toArray(learningSignals.concepts).map((c, i) => (
                                            <span key={i} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded">{c}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {toArray(learningSignals.takeaways).length > 0 && (
                                <div className="mb-2">
                                    <span className="text-xs font-semibold text-gray-500">Takeaways: </span>
                                    <ul className="text-sm text-gray-700 list-disc list-inside mt-1">
                                        {toArray(learningSignals.takeaways).map((t, i) => <li key={i}><Latex>{t}</Latex></li>)}
                                    </ul>
                                </div>
                            )}
                            {toArray(learningSignals.memory_hooks).length > 0 && (
                                <div>
                                    <span className="text-xs font-semibold text-gray-500">Memory Hooks: </span>
                                    <ul className="text-sm text-gray-700 list-disc list-inside mt-1">
                                        {toArray(learningSignals.memory_hooks).map((m, i) => <li key={i}><Latex>{m}</Latex></li>)}
                                    </ul>
                                </div>
                            )}
                        </CollapsibleSection>
                    )}
                    {studentHooks && (
                        <CollapsibleSection title="Student Errors">
                            {toArray(studentHooks.likely_errors).length > 0 && (
                                <div className="mb-2">
                                    <span className="text-xs font-semibold text-gray-500">Likely Errors: </span>
                                    <ul className="text-sm text-gray-700 list-disc list-inside mt-1">
                                        {toArray(studentHooks.likely_errors).map((e, i) => <li key={i}><Latex>{e}</Latex></li>)}
                                    </ul>
                                </div>
                            )}
                            {studentHooks.option_error_map && (
                                <div>
                                    <span className="text-xs font-semibold text-gray-500">Option Error Map: </span>
                                    <div className="grid grid-cols-2 gap-2 mt-1">
                                        {Object.entries(studentHooks.option_error_map).map(([key, val]) => (
                                            <div key={key} className={`text-xs p-2 rounded border ${key === correctLabel ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                                                <span className="font-bold">{key}:</span> <Latex>{val || '(correct)'}</Latex>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CollapsibleSection>
                    )}
                    {qualityCheck && (
                        <CollapsibleSection title="Quality Check"
                            badge={qualityCheck.issue_flag ? <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">Issues Found</span> : null}>
                            <div className="text-sm text-gray-700">
                                {qualityCheck.issue_flag ? (
                                    <>
                                        {toArray(qualityCheck.issue_type).length > 0 && (
                                            <div className="flex flex-wrap gap-1 mb-1">
                                                {toArray(qualityCheck.issue_type).map((t, i) => (
                                                    <span key={i} className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded">{t}</span>
                                                ))}
                                            </div>
                                        )}
                                        {qualityCheck.issue_note && <p>{qualityCheck.issue_note}</p>}
                                    </>
                                ) : (
                                    <span className="text-xs text-green-600">No issues detected.</span>
                                )}
                            </div>
                        </CollapsibleSection>
                    )}
                    {indexingMeta && (toArray(indexingMeta.keywords).length > 0 || toArray(indexingMeta.tags).length > 0) && (
                        <CollapsibleSection title="Metadata">
                            {toArray(indexingMeta?.keywords).length > 0 && (
                                <div className="mb-2">
                                    <span className="text-xs font-semibold text-gray-500">Keywords: </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {toArray(indexingMeta?.keywords).map((k, i) => (
                                            <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{k}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {toArray(indexingMeta?.tags).length > 0 && (
                                <div>
                                    <span className="text-xs font-semibold text-gray-500">Tags: </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {toArray(indexingMeta?.tags).map((t, i) => (
                                            <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{t}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CollapsibleSection>
                    )}
                </div>
            )}
        </div>
    );
}
