'use client';

import { useState } from 'react';
import Latex from '@/components/Latex';

const DIFFICULTY_MAP = {
    1: { label: 'Easy', cls: 'bg-green-100 text-green-700' },
    2: { label: 'Medium', cls: 'bg-yellow-100 text-yellow-700' },
    3: { label: 'Hard', cls: 'bg-red-100 text-red-700' },
};

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

export default function SolutionReview({ papers }) {
    const [selectedPaper, setSelectedPaper] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [filter, setFilter] = useState('all');

    const handlePaperClick = async (paper) => {
        setSelectedPaper(paper);
        setQuestions([]);
        setFeedback(null);
        setLoadingQuestions(true);

        try {
            const res = await fetch(`/api/solution-review/questions?paperId=${paper.paper_session_id}`);
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

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const filteredQuestions = questions.filter(q => {
        if (filter === 'solved') return q.solution_status === 'DONE';
        if (filter === 'unsolved') return q.solution_status !== 'DONE';
        return true;
    });

    const solvedCount = questions.filter(q => q.solution_status === 'DONE').length;

    return (
        <div className="flex h-screen overflow-hidden bg-white">
            {/* Left Sidebar */}
            <aside className="w-72 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
                <div className="px-4 py-4 border-b border-gray-200">
                    <h1 className="text-lg font-bold text-gray-900">Solution Review</h1>
                    <p className="text-xs text-gray-500 mt-0.5">{papers.length} papers ready</p>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {papers.length === 0 ? (
                        <div className="p-4 text-sm text-gray-400 italic text-center mt-8">
                            No papers with 90+ solutions found.
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {papers.map(paper => {
                                const isSelected = selectedPaper?.paper_session_id === paper.paper_session_id;
                                return (
                                    <li key={paper.paper_session_id}>
                                        <button onClick={() => handlePaperClick(paper)}
                                            className={`w-full text-left px-4 py-3 transition-colors hover:bg-blue-50 ${isSelected ? 'bg-blue-100 border-l-4 border-blue-500' : 'border-l-4 border-transparent'}`}>
                                            <div className="text-sm font-semibold text-gray-900 truncate">{paper.session_label}</div>
                                            {paper.exam_name && <div className="text-xs text-indigo-600 mt-0.5 truncate">{paper.exam_name}</div>}
                                            <div className="text-xs text-gray-500 mt-0.5">{paper.subject || 'No subject'}</div>
                                            <div className="flex items-center justify-between mt-1">
                                                <span className="text-xs text-gray-400">{formatDate(paper.paper_date)}</span>
                                                <span className="text-xs font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                                    {parseInt(paper.question_count || 0)} Qs
                                                </span>
                                            </div>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </aside>

            {/* Right Main Area */}
            <main className="flex-1 overflow-y-auto bg-gray-50">
                {!selectedPaper ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <h2 className="text-xl font-semibold text-gray-700">Select a paper to review solutions</h2>
                            <p className="text-gray-400 mt-2 text-sm">Choose a paper from the sidebar.</p>
                        </div>
                    </div>
                ) : (
                    <div>
                        {/* Sticky top bar */}
                        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm px-6 py-3 flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <h2 className="text-base font-bold text-gray-900 truncate">{selectedPaper.session_label}</h2>
                                <p className="text-xs text-gray-500">
                                    {selectedPaper.subject} &middot; {formatDate(selectedPaper.paper_date)} &middot; {solvedCount}/{questions.length} solved &middot; {filteredQuestions.length} showing
                                </p>
                            </div>
                            {feedback && (
                                <div className={`text-sm px-3 py-1.5 rounded font-medium ${feedback.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                                    {feedback.message}
                                </div>
                            )}
                            <div className="flex gap-1 flex-shrink-0">
                                {['all', 'solved', 'unsolved'].map(f => (
                                    <button key={f} onClick={() => setFilter(f)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                        {f.charAt(0).toUpperCase() + f.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Questions */}
                        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
                            {loadingQuestions ? (
                                <div className="flex items-center justify-center py-24">
                                    <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
                                    <span className="ml-3 text-gray-500">Loading questions...</span>
                                </div>
                            ) : filteredQuestions.length === 0 ? (
                                <div className="text-center py-24 text-gray-400">
                                    {filter === 'unsolved' ? 'All questions have solutions!' : 'No questions found.'}
                                </div>
                            ) : (
                                filteredQuestions.map((q, idx) => (
                                    <QuestionCard key={q.question_id} q={q} idx={idx} />
                                ))
                            )}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

function QuestionCard({ q, idx }) {
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

    return (
        <div className={`bg-white rounded-lg border shadow-sm overflow-hidden ${hasSolution ? 'border-green-300' : 'border-gray-200'}`}>
            {/* Header */}
            <div className={`px-5 py-3 border-b flex items-center justify-between ${hasSolution ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-gray-700">Q.{q.source_q_no || idx + 1}</span>
                    <span className="text-xs text-gray-400 font-mono">{q.question_id.slice(0, 8)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${hasSolution ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {hasSolution ? 'DONE' : q.solution_status || 'PENDING'}
                    </span>
                    <DifficultyBadge level={q.difficulty} />
                    {q.subtype && <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{q.subtype}</span>}
                    {q.section_code && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{q.section_code}</span>}
                </div>
                {answer && (
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 uppercase">Answer:</span>
                        <span className="text-sm font-bold text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full">{answer}</span>
                    </div>
                )}
            </div>

            {/* Question Text */}
            <div className="px-5 py-4 border-b border-gray-100">
                <div className="text-sm text-gray-800"><Latex>{q.question_text || '(No question text)'}</Latex></div>
            </div>

            {/* Options */}
            <div className="px-5 py-3 border-b border-gray-100">
                <div className="grid grid-cols-2 gap-3">
                    {(q.options || []).map(opt => {
                        const isCorrect = answer === opt.opt_label;
                        return (
                            <div key={opt.opt_label}
                                className={`flex gap-2 items-start p-3 rounded-md border ${isCorrect ? 'bg-green-50 border-green-400' : 'bg-white border-gray-200'}`}>
                                <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${isCorrect ? 'bg-green-500 text-white border-green-500' : 'bg-gray-100 text-gray-600 border-gray-300'}`}>
                                    {opt.opt_label}
                                </span>
                                <div className="text-sm text-gray-700 pt-0.5 flex-1"><Latex>{opt.opt_text || ''}</Latex></div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Solution content — only show if solution exists */}
            {hasSolution && (
                <div>
                    {/* Final Answer & Core Basis — always visible */}
                    {(finalAnswerText || coreBasis) && (
                        <div className="px-5 py-3 border-b border-gray-100 bg-blue-50">
                            {finalAnswerText && (
                                <div className="mb-1">
                                    <span className="text-xs text-gray-500 uppercase font-semibold">Final Answer: </span>
                                    <span className="text-sm text-gray-800">{finalAnswerText}</span>
                                </div>
                            )}
                            {coreBasis && (
                                <div>
                                    <span className="text-xs text-gray-500 uppercase font-semibold">Core Basis: </span>
                                    <span className="text-sm text-gray-700">{coreBasis}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Exam Craft / Display Sections */}
                    {displaySections && (
                        <CollapsibleSection title="Explanation" defaultOpen={true}>
                            {Array.isArray(displaySections) ? (
                                displaySections.map((sec, i) => (
                                    <div key={i} className="mb-2">
                                        {sec.key && <span className="text-xs font-bold text-gray-500 uppercase">{sec.key.replace(/_/g, ' ')}: </span>}
                                        <div className="text-sm text-gray-700 whitespace-pre-wrap">{sec.content}</div>
                                    </div>
                                ))
                            ) : typeof displaySections === 'object' ? (
                                Object.entries(displaySections).map(([key, val]) => (
                                    <div key={key} className="mb-2">
                                        <span className="text-xs font-bold text-gray-500 uppercase">{key.replace(/_/g, ' ')}: </span>
                                        <div className="text-sm text-gray-700 whitespace-pre-wrap">
                                            {typeof val === 'string' ? val : val?.approach || val?.content || JSON.stringify(val)}
                                        </div>
                                    </div>
                                ))
                            ) : null}
                        </CollapsibleSection>
                    )}

                    {/* Diagnostic Signals */}
                    {diagnosticSignals && (
                        <CollapsibleSection title="Diagnostic Signals">
                            {diagnosticSignals.mistake_patterns?.length > 0 && (
                                <div className="mb-2">
                                    <span className="text-xs font-semibold text-gray-500">Mistake Patterns: </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {diagnosticSignals.mistake_patterns.map((p, i) => (
                                            <span key={i} className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded">{p}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {diagnosticSignals.exam_skills_tested?.length > 0 && (
                                <div className="mb-2">
                                    <span className="text-xs font-semibold text-gray-500">Skills Tested: </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {diagnosticSignals.exam_skills_tested.map((s, i) => (
                                            <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{s}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {diagnosticSignals.trap_type?.length > 0 && (
                                <div>
                                    <span className="text-xs font-semibold text-gray-500">Traps: </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {diagnosticSignals.trap_type.map((t, i) => (
                                            <span key={i} className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">{t}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CollapsibleSection>
                    )}

                    {/* Learning Signals */}
                    {learningSignals && (
                        <CollapsibleSection title="Learning Signals">
                            {learningSignals.concepts?.length > 0 && (
                                <div className="mb-2">
                                    <span className="text-xs font-semibold text-gray-500">Concepts: </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {learningSignals.concepts.map((c, i) => (
                                            <span key={i} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded">{c}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {learningSignals.takeaways?.length > 0 && (
                                <div className="mb-2">
                                    <span className="text-xs font-semibold text-gray-500">Takeaways: </span>
                                    <ul className="text-sm text-gray-700 list-disc list-inside mt-1">
                                        {learningSignals.takeaways.map((t, i) => <li key={i}>{t}</li>)}
                                    </ul>
                                </div>
                            )}
                            {learningSignals.memory_hooks?.length > 0 && (
                                <div>
                                    <span className="text-xs font-semibold text-gray-500">Memory Hooks: </span>
                                    <ul className="text-sm text-gray-700 list-disc list-inside mt-1">
                                        {learningSignals.memory_hooks.map((m, i) => <li key={i}>{m}</li>)}
                                    </ul>
                                </div>
                            )}
                        </CollapsibleSection>
                    )}

                    {/* Student Errors & Option Error Map */}
                    {studentHooks && (
                        <CollapsibleSection title="Student Errors">
                            {studentHooks.likely_errors?.length > 0 && (
                                <div className="mb-2">
                                    <span className="text-xs font-semibold text-gray-500">Likely Errors: </span>
                                    <ul className="text-sm text-gray-700 list-disc list-inside mt-1">
                                        {studentHooks.likely_errors.map((e, i) => <li key={i}>{e}</li>)}
                                    </ul>
                                </div>
                            )}
                            {studentHooks.option_error_map && (
                                <div>
                                    <span className="text-xs font-semibold text-gray-500">Option Error Map: </span>
                                    <div className="grid grid-cols-2 gap-2 mt-1">
                                        {Object.entries(studentHooks.option_error_map).map(([key, val]) => (
                                            <div key={key} className={`text-xs p-2 rounded border ${key === answer ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                                                <span className="font-bold">{key}:</span> {val || '(correct)'}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CollapsibleSection>
                    )}

                    {/* Quality Check */}
                    {qualityCheck && (
                        <CollapsibleSection title="Quality Check"
                            badge={qualityCheck.issue_flag ? <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">Issues Found</span> : null}>
                            <div className="text-sm text-gray-700">
                                {qualityCheck.issue_flag ? (
                                    <>
                                        {qualityCheck.issue_type?.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mb-1">
                                                {qualityCheck.issue_type.map((t, i) => (
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

                    {/* Indexing Metadata */}
                    {indexingMeta && (indexingMeta.keywords?.length > 0 || indexingMeta.tags?.length > 0) && (
                        <CollapsibleSection title="Metadata">
                            {indexingMeta.keywords?.length > 0 && (
                                <div className="mb-2">
                                    <span className="text-xs font-semibold text-gray-500">Keywords: </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {indexingMeta.keywords.map((k, i) => (
                                            <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{k}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {indexingMeta.tags?.length > 0 && (
                                <div>
                                    <span className="text-xs font-semibold text-gray-500">Tags: </span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {indexingMeta.tags.map((t, i) => (
                                            <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{t}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CollapsibleSection>
                    )}

                    {/* Fallback: old-format solution_text */}
                    {!displaySections && q.solution_text && (
                        <CollapsibleSection title="Solution Text" defaultOpen={true}>
                            <div className="text-sm text-gray-700 whitespace-pre-wrap">{q.solution_text}</div>
                        </CollapsibleSection>
                    )}
                </div>
            )}

            {/* No solution */}
            {!hasSolution && (
                <div className="px-5 py-4 text-sm text-gray-400 italic">No solution generated yet.</div>
            )}
        </div>
    );
}
