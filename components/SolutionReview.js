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

export default function SolutionReview({ exams }) {
    const [selectedExamId, setSelectedExamId] = useState('');
    const [selectedLanguage, setSelectedLanguage] = useState('EN');
    const [papers, setPapers] = useState([]);
    const [loadingPapers, setLoadingPapers] = useState(false);
    const [selectedPaper, setSelectedPaper] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [filter, setFilter] = useState('all');

    // Fetch papers when exam or language changes
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

    const filteredQuestions = questions.filter(q => {
        if (filter === 'solved') return q.solution_status === 'DONE';
        if (filter === 'unsolved') return q.solution_status !== 'DONE';
        return true;
    });

    const solvedCount = questions.filter(q => q.solution_status === 'DONE').length;

    // Group questions by section_code for sidebar
    const groupedQuestions = questions.reduce((acc, q) => {
        const section = q.section_code || 'Other';
        if (!acc[section]) acc[section] = [];
        acc[section].push(q);
        return acc;
    }, {});

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-white">
            {/* Top Bar: Exam → Language → Paper cascading filters */}
            <div className="flex-shrink-0 bg-white border-b border-gray-200 shadow-sm px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-lg font-bold text-gray-900 flex-shrink-0">Solution Review</h1>

                    {/* Exam selector */}
                    <select value={selectedExamId} onChange={e => handleExamChange(e.target.value)}
                        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm min-w-[200px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                        <option value="">Select Exam...</option>
                        {exams.map(e => (
                            <option key={e.exam_id} value={e.exam_id}>{e.name}</option>
                        ))}
                    </select>

                    {/* Language selector */}
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

                    {/* Paper selector */}
                    {selectedExamId && (
                        <select
                            value={selectedPaper?.paper_session_id || ''}
                            onChange={e => e.target.value && handlePaperChange(e.target.value)}
                            disabled={loadingPapers}
                            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm min-w-[280px] max-w-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                        >
                            <option value="">{loadingPapers ? 'Loading papers...' : `Select Paper (${papers.length})...`}</option>
                            {papers.map(p => (
                                <option key={p.paper_session_id} value={p.paper_session_id}>
                                    {p.session_label} — {parseInt(p.solved_count || 0)}/{parseInt(p.question_count || 0)} solved
                                </option>
                            ))}
                        </select>
                    )}

                    {/* Stats + Filters */}
                    {selectedPaper && questions.length > 0 && (
                        <>
                            <span className="text-xs text-gray-500">
                                {solvedCount}/{questions.length} solved
                            </span>
                            <div className="flex gap-1 flex-shrink-0">
                                {['all', 'solved', 'unsolved'].map(f => (
                                    <button key={f} onClick={() => setFilter(f)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                        {f.charAt(0).toUpperCase() + f.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    {feedback && (
                        <div className={`text-sm px-3 py-1.5 rounded font-medium ${feedback.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                            {feedback.message}
                        </div>
                    )}
                </div>
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
                                                return (
                                                    <a
                                                        key={q.question_id}
                                                        href={`#sq-${q.question_id}`}
                                                        onClick={e => {
                                                            e.preventDefault();
                                                            const el = document.getElementById(`sq-${q.question_id}`);
                                                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                        }}
                                                        className={`flex items-center justify-center aspect-square text-xs font-medium rounded border transition-colors ${
                                                            hasSolution
                                                                ? 'text-gray-600 bg-green-50 border-green-200 hover:bg-green-100'
                                                                : 'text-red-700 bg-red-50 border-red-300 hover:bg-red-100'
                                                        }`}
                                                        title={`Q.${qLabel} — ${hasSolution ? 'DONE' : q.solution_status || 'PENDING'}`}
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
                                    <QuestionCard q={q} idx={idx} paperId={selectedPaper.paper_session_id} />
                                </div>
                            ))}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

// Safely convert a value to an array (handles strings, nulls, non-arrays)
function toArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') return [val];
    return [];
}

function QuestionCard({ q, idx, paperId }) {
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

    // Extract explanation text from display_sections
    const getExplanationText = () => {
        if (!displaySections) return '';
        if (Array.isArray(displaySections)) {
            return displaySections.map(sec => {
                const prefix = sec.key ? `[${sec.key.replace(/_/g, ' ')}] ` : '';
                return prefix + (sec.content || '');
            }).join('\n\n');
        }
        if (typeof displaySections === 'object') {
            return Object.entries(displaySections).map(([key, val]) => {
                const text = typeof val === 'string' ? val : val?.approach || val?.content || JSON.stringify(val);
                return `[${key.replace(/_/g, ' ')}] ${text}`;
            }).join('\n\n');
        }
        return '';
    };

    const [explanationText, setExplanationText] = useState(getExplanationText);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState(null);

    // Image paste upload
    const handlePaste = (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
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
                                language: 'EN',
                                version_no: q.version_no,
                                role: 'solution',
                                option_key: '__SOLUTION__',
                            }),
                        });
                        const data = await res.json();
                        if (data.latexPath) {
                            setExplanationText(prev => prev + `\n\n\\includegraphics{${data.latexPath}}`);
                        } else {
                            alert('Upload failed: ' + (data.error || 'Unknown error'));
                        }
                    } catch (err) {
                        console.error('Image upload error:', err);
                        alert('Upload failed');
                    }
                };
                break;
            }
        }
    };

    const handleSaveExplanation = async () => {
        setIsSaving(true);
        setSaveMsg(null);
        try {
            // Rebuild display_sections from edited text
            const updatedSj = { ...sj };
            if (Array.isArray(updatedSj.display_sections)) {
                updatedSj.display_sections = [{ key: 'exam_craft', content: explanationText }];
            } else {
                updatedSj.display_sections = { exam_craft: { approach: explanationText } };
            }

            const res = await fetch('/api/solution-review/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paper_session_id: paperId,
                    solutions: [{
                        question_id: q.question_id,
                        version_no: q.version_no,
                        answer_label: answer || '',
                        solution_text: explanationText,
                        difficulty: q.difficulty || '',
                        tags: '',
                        full_json: updatedSj,
                    }],
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setSaveMsg('Saved!');
                setTimeout(() => setSaveMsg(null), 2000);
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
                                    <span className="text-sm text-gray-800"><Latex>{finalAnswerText}</Latex></span>
                                </div>
                            )}
                            {coreBasis && (
                                <div>
                                    <span className="text-xs text-gray-500 uppercase font-semibold">Core Basis: </span>
                                    <span className="text-sm text-gray-700"><Latex>{coreBasis}</Latex></span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Editable Explanation */}
                    <div className="px-5 py-3 border-b border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Explanation</label>
                            <div className="flex items-center gap-2">
                                {saveMsg && <span className={`text-xs font-semibold ${saveMsg === 'Saved!' ? 'text-green-600' : 'text-red-600'}`}>{saveMsg}</span>}
                                <button onClick={handleSaveExplanation} disabled={isSaving}
                                    className="px-3 py-1 text-xs font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                                    {isSaving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </div>
                        <textarea
                            rows={6}
                            value={explanationText}
                            onChange={e => setExplanationText(e.target.value)}
                            onPaste={handlePaste}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y mb-2"
                            placeholder="Edit explanation... (paste images directly)"
                        />
                        {explanationText && (
                            <div className="p-3 bg-gray-50 rounded border border-gray-200 text-sm">
                                <p className="text-xs font-bold text-gray-400 uppercase mb-1">Preview</p>
                                <Latex>{explanationText}</Latex>
                            </div>
                        )}
                    </div>

                    {/* Figure Prompt */}
                    {(figurePrompt || figureHelpful) && (
                        <div className="px-5 py-3 border-b border-gray-100 bg-amber-50">
                            <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide block mb-1">Figure Prompt</label>
                            {figureHelpful && <span className="text-xs text-amber-600 mr-2">(Figure would be helpful)</span>}
                            {figurePrompt && <div className="text-sm text-gray-700">{figurePrompt}</div>}
                        </div>
                    )}

                    {/* Diagnostic Signals */}
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

                    {/* Learning Signals */}
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

                    {/* Student Errors & Option Error Map */}
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
                                            <div key={key} className={`text-xs p-2 rounded border ${key === answer ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                                                <span className="font-bold">{key}:</span> <Latex>{val || '(correct)'}</Latex>
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

                    {/* Indexing Metadata */}
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
