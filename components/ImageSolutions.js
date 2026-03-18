'use client';

import { useState, useCallback } from 'react';
import Latex from '@/components/Latex';

// Collapsible section component
function Section({ title, defaultOpen = false, highlight = false, children }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className={`border rounded-md overflow-hidden ${highlight ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
            <button
                onClick={() => setOpen(!open)}
                className={`w-full text-left px-4 py-2.5 text-sm font-semibold flex items-center justify-between ${highlight ? 'bg-red-50 text-red-800' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}`}
            >
                {title}
                <span className="text-xs">{open ? '▲' : '▼'}</span>
            </button>
            {open && <div className="px-4 py-3 text-sm">{children}</div>}
        </div>
    );
}

// Difficulty badge
function DifficultyBadge({ level }) {
    if (!level) return null;
    const map = { 1: ['Easy', 'bg-green-100 text-green-700'], 2: ['Medium', 'bg-yellow-100 text-yellow-700'], 3: ['Hard', 'bg-red-100 text-red-700'] };
    const [label, cls] = map[level] || ['?', 'bg-gray-100 text-gray-600'];
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

export default function ImageSolutions({ papers }) {
    const [selectedPaper, setSelectedPaper] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [selectedOptions, setSelectedOptions] = useState({});   // questionId -> option label
    const [reviewerNotes, setReviewerNotes] = useState({});       // questionId -> notes text
    const [aiResults, setAiResults] = useState({});               // questionId -> parsed result
    const [generatingId, setGeneratingId] = useState(null);
    const [savingId, setSavingId] = useState(null);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [filter, setFilter] = useState('unsolved');

    const handlePaperClick = async (paper) => {
        setSelectedPaper(paper);
        setQuestions([]);
        setSelectedOptions({});
        setReviewerNotes({});
        setAiResults({});
        setFeedback(null);
        setLoadingQuestions(true);

        try {
            const res = await fetch(`/api/image-solutions/questions?paperId=${paper.paper_session_id}`);
            const data = await res.json();
            if (res.ok && data.questions) {
                setQuestions(data.questions);
                // Pre-populate selected options from saved data
                const opts = {};
                const results = {};
                for (const q of data.questions) {
                    const label = q.answer_label || q.correct_option_label;
                    if (label) opts[q.question_id] = label;
                    // If solution_json has display_sections, treat as rich result
                    if (q.solution_json?.display_sections) {
                        results[q.question_id] = {
                            full_json: q.solution_json,
                            correct_option_label: q.solution_json.correct_option_label || label,
                            difficulty: q.difficulty,
                            difficulty_label: q.solution_json.difficulty,
                            subtype: q.solution_json.subtype,
                            final_answer_text: q.solution_json.final_answer_text,
                            recheck_options: q.solution_json.recheck_options,
                            figure_helpful: q.solution_json.figure_helpful,
                            figure_prompt: q.solution_json.figure_prompt,
                        };
                    }
                }
                setSelectedOptions(opts);
                setAiResults(results);
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

    const handleGenerate = useCallback(async (q) => {
        setGeneratingId(q.question_id);
        setFeedback(null);

        try {
            const res = await fetch('/api/image-solutions/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: q.question_id,
                    version_no: q.version_no,
                    language: q.language || 'EN',
                    question_text: q.question_text,
                    options: q.options,
                    exam_name: selectedPaper?.exam_name || '',
                    section: q.section_code || '',
                    reviewer_notes: reviewerNotes[q.question_id] || '',
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setAiResults(prev => ({ ...prev, [q.question_id]: data.parsed }));
                // Auto-select the AI's answer
                if (data.parsed.correct_option_label) {
                    setSelectedOptions(prev => ({ ...prev, [q.question_id]: data.parsed.correct_option_label }));
                }
                setFeedback({ type: 'success', message: `AI solution generated for Q.${q.source_q_no || q.question_id.slice(0, 6)}` });
            } else {
                setFeedback({ type: 'error', message: data.error || 'AI generation failed.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error during AI generation.' });
        } finally {
            setGeneratingId(null);
        }
    }, [selectedPaper, reviewerNotes]);

    const handleSave = useCallback(async (q) => {
        const answerLabel = selectedOptions[q.question_id];
        const aiResult = aiResults[q.question_id];

        if (!answerLabel && !aiResult?.correct_option_label) {
            setFeedback({ type: 'error', message: 'Please select an answer or generate AI solution first.' });
            return;
        }

        setSavingId(q.question_id);
        setFeedback(null);

        try {
            const payload = {
                question_id: q.question_id,
                version_no: q.version_no,
                language: q.language || 'EN',
            };

            if (aiResult) {
                // Rich format
                payload.parsed = {
                    ...aiResult,
                    correct_option_label: answerLabel || aiResult.correct_option_label,
                };
            } else {
                // Legacy format
                payload.answer_label = answerLabel;
                payload.solution_text = '';
            }

            const res = await fetch('/api/image-solutions/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', message: `Q.${q.source_q_no || q.question_id.slice(0, 6)} saved!` });
                setQuestions(prev => prev.map(pq =>
                    pq.question_id === q.question_id
                        ? { ...pq, answer_label: answerLabel || aiResult?.correct_option_label, solution_status: 'DONE', difficulty: aiResult?.difficulty || pq.difficulty }
                        : pq
                ));
            } else {
                setFeedback({ type: 'error', message: data.error || 'Save failed.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error during save.' });
        } finally {
            setSavingId(null);
        }
    }, [selectedOptions, aiResults]);

    const extractImages = (text) => {
        if (!text) return [];
        const regex = /\\includegraphics\{([^}]+)\}/g;
        const urls = [];
        let match;
        while ((match = regex.exec(text)) !== null) urls.push(match[1]);
        return urls;
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const filteredQuestions = questions.filter(q => {
        if (filter === 'unsolved') return !q.answer_label && !q.correct_option_label;
        if (filter === 'solved') return !!q.answer_label || !!q.correct_option_label;
        return true;
    });

    return (
        <div className="flex h-screen overflow-hidden bg-white">
            {/* Left Sidebar */}
            <aside className="w-72 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
                <div className="px-4 py-4 border-b border-gray-200">
                    <h1 className="text-lg font-bold text-gray-900">Img Sol</h1>
                    <p className="text-xs text-gray-500 mt-0.5">{papers.length} papers with image questions</p>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {papers.length === 0 ? (
                        <div className="p-4 text-sm text-gray-400 italic text-center mt-8">
                            No papers with image questions found.
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {papers.map(paper => {
                                const isSelected = selectedPaper?.paper_session_id === paper.paper_session_id;
                                const total = parseInt(paper.image_question_count || 0);
                                const solved = parseInt(paper.solved_count || 0);
                                const allDone = total > 0 && solved === total;
                                return (
                                    <li key={paper.paper_session_id}>
                                        <button
                                            onClick={() => handlePaperClick(paper)}
                                            className={`w-full text-left px-4 py-3 transition-colors hover:bg-orange-50 ${isSelected ? 'bg-orange-100 border-l-4 border-orange-500' : 'border-l-4 border-transparent'}`}
                                        >
                                            <div className="text-sm font-semibold text-gray-900 truncate">{paper.session_label}</div>
                                            {paper.exam_name && (
                                                <div className="text-xs text-indigo-600 mt-0.5 truncate">{paper.exam_name}</div>
                                            )}
                                            <div className="text-xs text-gray-500 mt-0.5">{paper.subject || 'No subject'}</div>
                                            <div className="flex items-center justify-between mt-1">
                                                <span className="text-xs text-gray-400">{formatDate(paper.paper_date)}</span>
                                                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${allDone ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                                    {solved}/{total} done
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
                            <h2 className="text-xl font-semibold text-gray-700">Select a paper to review</h2>
                            <p className="text-gray-400 mt-2 text-sm">Choose a paper from the left to review image questions and provide answers.</p>
                        </div>
                    </div>
                ) : (
                    <div>
                        {/* Sticky top bar */}
                        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm px-6 py-3 flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-base font-bold text-gray-900 truncate">{selectedPaper.session_label}</h2>
                                    {selectedPaper.source_pdf_path && (
                                        <a href={selectedPaper.source_pdf_path} target="_blank" rel="noopener noreferrer"
                                            className="text-xs text-blue-600 hover:text-blue-800 font-medium flex-shrink-0">
                                            Source PDF
                                        </a>
                                    )}
                                </div>
                                <p className="text-xs text-gray-500">
                                    {selectedPaper.subject} &middot; {formatDate(selectedPaper.paper_date)} &middot; {filteredQuestions.length} showing
                                </p>
                            </div>
                            {feedback && (
                                <div className={`text-sm px-3 py-1.5 rounded font-medium ${feedback.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                                    {feedback.message}
                                </div>
                            )}
                            <div className="flex gap-1 flex-shrink-0">
                                {['unsolved', 'all', 'solved'].map(f => (
                                    <button
                                        key={f}
                                        onClick={() => setFilter(f)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${filter === f
                                            ? 'bg-orange-600 text-white'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }`}
                                    >
                                        {f.charAt(0).toUpperCase() + f.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Questions */}
                        <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
                            {loadingQuestions ? (
                                <div className="flex items-center justify-center py-24">
                                    <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full"></div>
                                    <span className="ml-3 text-gray-500">Loading image questions...</span>
                                </div>
                            ) : filteredQuestions.length === 0 ? (
                                <div className="text-center py-24 text-gray-400">
                                    {filter === 'unsolved' ? 'All image questions are solved!' : 'No image questions found.'}
                                </div>
                            ) : (
                                filteredQuestions.map((q, idx) => (
                                    <QuestionCard
                                        key={q.question_id}
                                        q={q}
                                        idx={idx}
                                        selectedOption={selectedOptions[q.question_id]}
                                        onSelectOption={(label) => setSelectedOptions(prev => ({ ...prev, [q.question_id]: label }))}
                                        reviewerNote={reviewerNotes[q.question_id] || ''}
                                        onNoteChange={(val) => setReviewerNotes(prev => ({ ...prev, [q.question_id]: val }))}
                                        aiResult={aiResults[q.question_id]}
                                        isGenerating={generatingId === q.question_id}
                                        isSaving={savingId === q.question_id}
                                        onGenerate={() => handleGenerate(q)}
                                        onSave={() => handleSave(q)}
                                        extractImages={extractImages}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

function QuestionCard({ q, idx, selectedOption, onSelectOption, reviewerNote, onNoteChange, aiResult, isGenerating, isSaving, onGenerate, onSave, extractImages }) {
    const isSolved = !!q.answer_label || !!q.correct_option_label || q.solution_status === 'DONE';
    const images = extractImages(q.question_text);
    const ds = aiResult?.full_json?.display_sections;

    return (
        <div className={`bg-white rounded-lg border shadow-sm overflow-hidden ${isSolved ? 'border-green-300' : 'border-gray-200'}`}>
            {/* 1. Header */}
            <div className={`px-5 py-3 border-b flex items-center justify-between ${isSolved ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'}`}>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-700">Q.{q.source_q_no || idx + 1}</span>
                    <span className="text-xs text-gray-400 font-mono">{q.question_id.slice(0, 8)}</span>
                    {isSolved && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">Solved</span>}
                    <DifficultyBadge level={q.difficulty || aiResult?.difficulty} />
                    {q.section_code && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{q.section_code}</span>}
                </div>
            </div>

            {/* 2. Question body — full width (Latex renders \includegraphics inline, no separate img tags) */}
            <div className="px-5 py-4 border-b border-gray-100">
                {/* Show asset images only if question text has no embedded \includegraphics */}
                {images.length === 0 && q.assets?.length > 0 && (
                    <div className="flex flex-wrap gap-3 mb-3">
                        {q.assets.filter(a => a.role === 'question' || !a.option_key).map((asset, i) => (
                            <img key={i} src={asset.image_url} alt={`Q.${q.source_q_no || idx + 1} asset`}
                                className="max-h-48 rounded border border-gray-200 bg-white object-contain" />
                        ))}
                    </div>
                )}
                <div className="text-sm text-gray-800">
                    <Latex>{q.question_text || '(No question text)'}</Latex>
                </div>
            </div>

            {/* 3. Options row — grid-cols-4 */}
            <div className="px-5 py-4 border-b border-gray-100">
                <div className="grid grid-cols-4 gap-3">
                    {(q.options || []).map(opt => {
                        const isSelected = selectedOption === opt.opt_label;
                        const optAsset = q.assets?.find(a => a.option_key === opt.opt_label);
                        // Check if opt_text is purely an \includegraphics command (no meaningful text besides it)
                        const textWithoutImages = (opt.opt_text || '').replace(/\\includegraphics\{[^}]+\}/g, '').trim();
                        const hasOnlyImage = opt.opt_text && !textWithoutImages;
                        return (
                            <button
                                key={opt.opt_label}
                                onClick={() => onSelectOption(opt.opt_label)}
                                className={`flex flex-col items-center p-3 rounded-lg border text-center transition-all ${isSelected
                                    ? 'bg-green-50 border-green-400 ring-2 ring-green-300'
                                    : 'bg-white border-gray-200 hover:border-gray-400 hover:bg-gray-50'
                                }`}
                            >
                                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border mb-2 ${isSelected
                                    ? 'bg-green-500 text-white border-green-500'
                                    : 'bg-gray-100 text-gray-600 border-gray-300'
                                }`}>
                                    {opt.opt_label}
                                </span>
                                {optAsset ? (
                                    <img src={optAsset.image_url} alt={`Option ${opt.opt_label}`}
                                        className="max-h-24 object-contain mb-1" />
                                ) : opt.opt_text ? (
                                    <div className="text-xs text-gray-700 break-words w-full">
                                        <Latex>{opt.opt_text}</Latex>
                                    </div>
                                ) : null}
                                {/* Show remaining text alongside asset image if opt_text has text beyond the image */}
                                {optAsset && textWithoutImages && !hasOnlyImage && (
                                    <div className="text-xs text-gray-700 break-words w-full mt-1">
                                        <Latex>{textWithoutImages}</Latex>
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 4. Reviewer notes + AI trigger */}
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
                <div className="flex gap-3 items-end">
                    <div className="flex-1">
                        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1.5">Reviewer Notes (optional context for AI)</label>
                        <textarea
                            rows={2}
                            value={reviewerNote}
                            onChange={e => onNoteChange(e.target.value)}
                            placeholder="Add context, hints, or corrections for the AI..."
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-y"
                        />
                    </div>
                    <button
                        onClick={onGenerate}
                        disabled={isGenerating}
                        className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1.5 flex-shrink-0"
                    >
                        {isGenerating ? (
                            <>
                                <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                                Generating...
                            </>
                        ) : (
                            'Solve with AI'
                        )}
                    </button>
                </div>
            </div>

            {/* 5. AI Result Display */}
            {aiResult && <AiResultDisplay result={aiResult} />}

            {/* 6. Save button */}
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                <div className="text-xs text-gray-500">
                    {selectedOption && <span>Selected: <strong>{selectedOption}</strong></span>}
                    {aiResult?.language_check && <span className="ml-3">Lang check: {aiResult.language_check}</span>}
                </div>
                <button
                    onClick={onSave}
                    disabled={isSaving || (!selectedOption && !aiResult?.correct_option_label)}
                    className="px-5 py-2.5 bg-orange-600 text-white text-sm font-semibold rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                    {isSaving ? (
                        <>
                            <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                            Saving...
                        </>
                    ) : (
                        'Save'
                    )}
                </button>
            </div>
        </div>
    );
}

function AiResultDisplay({ result }) {
    const fj = result.full_json;
    if (!fj) return null;
    const ds = fj.display_sections || {};

    return (
        <div className="px-5 py-4 space-y-3">
            {/* Answer & Difficulty — always visible */}
            <div className="flex items-center gap-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div>
                    <span className="text-xs text-gray-500 uppercase">Answer</span>
                    <div className="text-lg font-bold text-blue-800">{fj.correct_option_label || '?'}</div>
                </div>
                <div>
                    <span className="text-xs text-gray-500 uppercase">Difficulty</span>
                    <div><DifficultyBadge level={result.difficulty} /></div>
                </div>
                {fj.subtype && (
                    <div>
                        <span className="text-xs text-gray-500 uppercase">Subtype</span>
                        <div className="text-sm font-medium text-gray-700">{fj.subtype}</div>
                    </div>
                )}
                {fj.final_answer_text && (
                    <div className="flex-1">
                        <span className="text-xs text-gray-500 uppercase">Final Answer</span>
                        <div className="text-sm text-gray-700">{fj.final_answer_text}</div>
                    </div>
                )}
                {fj.recheck_options && (
                    <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded font-semibold">Recheck Options</span>
                )}
            </div>

            {/* Exam Craft — expanded by default */}
            {ds.exam_craft && (
                <Section title={ds.exam_craft.title || 'Solution'} defaultOpen={true}>
                    {ds.exam_craft.approach && (
                        <div className="mb-2">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Approach</div>
                            <div className="text-gray-700 whitespace-pre-wrap">{ds.exam_craft.approach}</div>
                        </div>
                    )}
                    {ds.exam_craft.key_concept && (
                        <div className="mb-2">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Key Concept</div>
                            <div className="text-gray-700">{ds.exam_craft.key_concept}</div>
                        </div>
                    )}
                    {ds.exam_craft.shortcut && (
                        <div className="mb-2">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Shortcut/Trick</div>
                            <div className="text-gray-700">{ds.exam_craft.shortcut}</div>
                        </div>
                    )}
                    {ds.exam_craft.time_estimate_seconds && (
                        <div className="text-xs text-gray-400">Est. time: {ds.exam_craft.time_estimate_seconds}s</div>
                    )}
                </Section>
            )}

            {/* Diagnostic Signals */}
            {ds.diagnostic_signals && (
                <Section title={ds.diagnostic_signals.title || 'Diagnostic Signals'}>
                    {ds.diagnostic_signals.topic_chain && (
                        <div className="mb-2">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Topic Chain</div>
                            <div className="flex gap-1 flex-wrap">
                                {ds.diagnostic_signals.topic_chain.map((t, i) => (
                                    <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                        {i > 0 && '→ '}{t}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    {ds.diagnostic_signals.bloom_level && (
                        <div className="mb-2">
                            <span className="text-xs text-gray-500">Bloom&apos;s: </span>
                            <span className="text-xs font-medium text-gray-700">{ds.diagnostic_signals.bloom_level}</span>
                        </div>
                    )}
                    {ds.diagnostic_signals.skill_tested && (
                        <div>
                            <span className="text-xs text-gray-500">Skill: </span>
                            <span className="text-xs text-gray-700">{ds.diagnostic_signals.skill_tested}</span>
                        </div>
                    )}
                </Section>
            )}

            {/* Learning Signals */}
            {ds.learning_signals && (
                <Section title={ds.learning_signals.title || 'Learning Signals'}>
                    {ds.learning_signals.prerequisite_concepts?.length > 0 && (
                        <div className="mb-2">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Prerequisites</div>
                            <div className="flex gap-1 flex-wrap">
                                {ds.learning_signals.prerequisite_concepts.map((c, i) => (
                                    <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{c}</span>
                                ))}
                            </div>
                        </div>
                    )}
                    {ds.learning_signals.related_questions_hint && (
                        <div className="mb-2 text-xs text-gray-600">{ds.learning_signals.related_questions_hint}</div>
                    )}
                    {ds.learning_signals.mnemonic && (
                        <div className="p-2 bg-yellow-50 rounded text-xs text-yellow-800 border border-yellow-200">
                            {ds.learning_signals.mnemonic}
                        </div>
                    )}
                </Section>
            )}

            {/* Student Errors + option_error_map */}
            {ds.student_errors && (
                <Section title={ds.student_errors.title || 'Common Student Errors'}>
                    {ds.student_errors.common_mistakes?.length > 0 && (
                        <div className="mb-3">
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Common Mistakes</div>
                            <ul className="list-disc list-inside text-xs text-gray-700 space-y-1">
                                {ds.student_errors.common_mistakes.map((m, i) => <li key={i}>{m}</li>)}
                            </ul>
                        </div>
                    )}
                    {ds.student_errors.option_error_map && (
                        <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Why Students Pick Each Option</div>
                            <div className="grid grid-cols-2 gap-2">
                                {Object.entries(ds.student_errors.option_error_map).map(([key, val]) => (
                                    val && (
                                        <div key={key} className={`text-xs p-2 rounded border ${key === fj.correct_option_label ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                                            <span className="font-bold">{key}:</span> {val}
                                        </div>
                                    )
                                ))}
                            </div>
                        </div>
                    )}
                </Section>
            )}

            {/* Quality Check */}
            {ds.quality_check && (
                <Section
                    title={ds.quality_check.title || 'Quality Check'}
                    highlight={ds.quality_check.issue_flag}
                >
                    {ds.quality_check.issue_flag ? (
                        <div>
                            {ds.quality_check.issues?.length > 0 && (
                                <ul className="list-disc list-inside text-xs text-red-700 space-y-1 mb-2">
                                    {ds.quality_check.issues.map((iss, i) => <li key={i}>{iss}</li>)}
                                </ul>
                            )}
                            {ds.quality_check.suggested_fix && (
                                <div className="text-xs text-gray-700 p-2 bg-white rounded border border-gray-200">
                                    <strong>Suggested fix:</strong> {ds.quality_check.suggested_fix}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-xs text-green-700">No issues detected.</div>
                    )}
                </Section>
            )}

            {/* Metadata tags */}
            {fj.metadata_tags && (
                <Section title="Metadata Tags">
                    <div className="flex flex-wrap gap-2">
                        {fj.metadata_tags.subject && <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded">Subject: {fj.metadata_tags.subject}</span>}
                        {fj.metadata_tags.topic && <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded">Topic: {fj.metadata_tags.topic}</span>}
                        {fj.metadata_tags.subtopic && <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded">Subtopic: {fj.metadata_tags.subtopic}</span>}
                        {fj.metadata_tags.exam_relevance?.length > 0 && (
                            fj.metadata_tags.exam_relevance.map((e, i) => (
                                <span key={i} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">{e}</span>
                            ))
                        )}
                    </div>
                </Section>
            )}

            {/* Figure prompt */}
            {fj.figure_helpful && fj.figure_prompt && (
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800">
                    <strong>Figure suggestion:</strong> {fj.figure_prompt}
                </div>
            )}
        </div>
    );
}
