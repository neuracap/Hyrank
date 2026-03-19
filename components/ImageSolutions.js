'use client';

import { useState, useCallback } from 'react';
import Latex from '@/components/Latex';

const SUBTYPES = [
    { key: 'visual_series', label: 'Visual Series' },
    { key: 'coding_decoding', label: 'Coding/Decoding' },
    { key: 'venn_diagram', label: 'Venn Diagram' },
    { key: 'embedded_figure', label: 'Embedded Figure' },
    { key: 'mirror_image', label: 'Mirror Image' },
    { key: 'paper_folding', label: 'Paper Folding' },
    { key: 'count_polygons', label: 'Count Polygons' },
    { key: 'cube_dice', label: 'Cube/Dice' },
    { key: 'other', label: 'Other' },
];

const DIFFICULTIES = [
    { key: 'easy', label: 'Easy', cls: 'bg-green-100 text-green-700 border-green-300', active: 'bg-green-600 text-white border-green-600' },
    { key: 'medium', label: 'Medium', cls: 'bg-yellow-50 text-yellow-700 border-yellow-300', active: 'bg-yellow-500 text-white border-yellow-500' },
    { key: 'hard', label: 'Hard', cls: 'bg-red-50 text-red-700 border-red-300', active: 'bg-red-600 text-white border-red-600' },
];

const difficultyToInt = { easy: 1, medium: 2, hard: 3 };

function DifficultyBadge({ level }) {
    if (!level) return null;
    const map = { 1: ['Easy', 'bg-green-100 text-green-700'], 2: ['Medium', 'bg-yellow-100 text-yellow-700'], 3: ['Hard', 'bg-red-100 text-red-700'] };
    const [label, cls] = map[level] || ['?', 'bg-gray-100 text-gray-600'];
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

export default function ImageSolutions({ papers }) {
    const [selectedPaper, setSelectedPaper] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [selectedOptions, setSelectedOptions] = useState({});
    const [subtypes, setSubtypes] = useState({});
    const [difficulties, setDifficulties] = useState({});
    const [solutionsEn, setSolutionsEn] = useState({});
    const [solutionsHi, setSolutionsHi] = useState({});
    const [aiResults, setAiResults] = useState({});
    const [generatingId, setGeneratingId] = useState(null);
    const [translatingId, setTranslatingId] = useState(null);
    const [savingId, setSavingId] = useState(null);
    const [flaggingId, setFlaggingId] = useState(null);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [filter, setFilter] = useState('unsolved');
    const [sourcePdfPath, setSourcePdfPath] = useState(null);

    const handlePaperClick = async (paper) => {
        setSelectedPaper(paper);
        setSourcePdfPath(null);
        setQuestions([]);
        setSelectedOptions({});
        setSubtypes({});
        setDifficulties({});
        setSolutionsEn({});
        setSolutionsHi({});
        setAiResults({});
        setFeedback(null);
        setLoadingQuestions(true);

        try {
            const res = await fetch(`/api/image-solutions/questions?paperId=${paper.paper_session_id}`);
            const data = await res.json();
            if (res.ok && data.questions) {
                setQuestions(data.questions);
                if (data.source_pdf_path) setSourcePdfPath(data.source_pdf_path);
                const opts = {}, subs = {}, diffs = {}, solEn = {}, solHi = {}, results = {};
                for (const q of data.questions) {
                    const label = q.answer_label || q.correct_option_label;
                    if (label) opts[q.question_id] = label;
                    if (q.solution_json?.question_identity?.subtype) subs[q.question_id] = q.solution_json.question_identity.subtype;
                    else if (q.solution_json?.subtype) subs[q.question_id] = q.solution_json.subtype;
                    if (q.difficulty) {
                        const dm = { 1: 'easy', 2: 'medium', 3: 'hard' };
                        diffs[q.question_id] = dm[q.difficulty] || '';
                    }
                    // Pre-populate exam_craft from saved solution
                    if (q.solution_json?.display_sections) {
                        const ds = q.solution_json.display_sections;
                        if (Array.isArray(ds)) {
                            const ec = ds.find(s => s.key === 'exam_craft');
                            if (ec?.content) solEn[q.question_id] = ec.content;
                        } else if (ds.exam_craft?.approach) {
                            solEn[q.question_id] = ds.exam_craft.approach;
                        }
                        results[q.question_id] = {
                            full_json: q.solution_json,
                            correct_option_label: label,
                            difficulty: q.difficulty,
                            subtype: subs[q.question_id],
                        };
                    }
                }
                setSelectedOptions(opts);
                setSubtypes(subs);
                setDifficulties(diffs);
                setSolutionsEn(solEn);
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

    const handleTranslate = useCallback(async (questionId) => {
        const text = solutionsEn[questionId];
        if (!text) { setFeedback({ type: 'error', message: 'Write the English explanation first.' }); return; }
        setTranslatingId(questionId);
        try {
            const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, source: 'en', target: 'hi' }),
            });
            const data = await res.json();
            if (res.ok && data.translatedText) {
                setSolutionsHi(prev => ({ ...prev, [questionId]: data.translatedText }));
            } else {
                setFeedback({ type: 'error', message: data.error || 'Translation failed.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error during translation.' });
        } finally {
            setTranslatingId(null);
        }
    }, [solutionsEn]);

    const handleGenerate = useCallback(async (q) => {
        const answerLabel = selectedOptions[q.question_id];
        if (!answerLabel) { setFeedback({ type: 'error', message: 'Select the correct answer first.' }); return; }

        setGeneratingId(q.question_id);
        setFeedback(null);

        try {
            const res = await fetch('/api/image-solutions/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: q.question_id,
                    language: q.language || 'EN',
                    question_text: q.question_text,
                    options: q.options,
                    correct_option: answerLabel,
                    subtype: subtypes[q.question_id] || 'other',
                    difficulty: difficulties[q.question_id] || 'medium',
                    exam_craft: solutionsEn[q.question_id] || '',
                    exam_name: selectedPaper?.exam_name || '',
                    section: q.section_code || '',
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setAiResults(prev => ({ ...prev, [q.question_id]: data.parsed }));
                setFeedback({ type: 'success', message: `AI enrichment done for Q.${q.source_q_no || q.question_id.slice(0, 6)}` });
            } else {
                setFeedback({ type: 'error', message: data.error || 'AI generation failed.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error during AI generation.' });
        } finally {
            setGeneratingId(null);
        }
    }, [selectedPaper, selectedOptions, subtypes, difficulties, solutionsEn]);

    const handleSave = useCallback(async (q) => {
        const answerLabel = selectedOptions[q.question_id];
        const aiResult = aiResults[q.question_id];

        if (!answerLabel) { setFeedback({ type: 'error', message: 'Select the correct answer first.' }); return; }
        if (!aiResult) { setFeedback({ type: 'error', message: 'Generate AI enrichment first.' }); return; }

        setSavingId(q.question_id);
        setFeedback(null);

        try {
            const diff = difficulties[q.question_id];
            const res = await fetch('/api/image-solutions/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: q.question_id,
                    version_no: q.version_no,
                    language: q.language || 'EN',
                    parsed: {
                        ...aiResult,
                        correct_option_label: answerLabel,
                        subtype: subtypes[q.question_id] || 'other',
                        difficulty: diff ? difficultyToInt[diff] : aiResult.difficulty,
                    },
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', message: `Q.${q.source_q_no || q.question_id.slice(0, 6)} saved!` });
                setQuestions(prev => prev.map(pq =>
                    pq.question_id === q.question_id
                        ? { ...pq, answer_label: answerLabel, solution_status: 'DONE', difficulty: diff ? difficultyToInt[diff] : pq.difficulty }
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
    }, [selectedOptions, aiResults, subtypes, difficulties]);

    const handleFlag = useCallback(async (q) => {
        setFlaggingId(q.question_id);
        setFeedback(null);
        try {
            const res = await fetch('/api/image-solutions/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: q.question_id,
                    version_no: q.version_no,
                    language: q.language || 'EN',
                    action: 'flag',
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', message: `Q.${q.source_q_no || q.question_id.slice(0, 6)} flagged.` });
                setQuestions(prev => prev.map(pq =>
                    pq.question_id === q.question_id ? { ...pq, status: 'FLAGGED' } : pq
                ));
            } else {
                setFeedback({ type: 'error', message: data.error || 'Flag failed.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error during flag.' });
        } finally {
            setFlaggingId(null);
        }
    }, []);

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
                    <h1 className="text-lg font-bold text-gray-900">Img Sol (Solo)</h1>
                    <p className="text-xs text-gray-500 mt-0.5">{papers.length} papers with image questions</p>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {papers.length === 0 ? (
                        <div className="p-4 text-sm text-gray-400 italic text-center mt-8">No papers with image questions found.</div>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {papers.map(paper => {
                                const isSelected = selectedPaper?.paper_session_id === paper.paper_session_id;
                                const total = parseInt(paper.image_question_count || 0);
                                const solved = parseInt(paper.solved_count || 0);
                                const allDone = total > 0 && solved === total;
                                return (
                                    <li key={paper.paper_session_id}>
                                        <button onClick={() => handlePaperClick(paper)}
                                            className={`w-full text-left px-4 py-3 transition-colors hover:bg-orange-50 ${isSelected ? 'bg-orange-100 border-l-4 border-orange-500' : 'border-l-4 border-transparent'}`}>
                                            <div className="text-sm font-semibold text-gray-900 truncate">{paper.session_label}</div>
                                            {paper.exam_name && <div className="text-xs text-indigo-600 mt-0.5 truncate">{paper.exam_name}</div>}
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
                            <p className="text-gray-400 mt-2 text-sm">Choose a paper from the left to review image questions.</p>
                        </div>
                    </div>
                ) : (
                    <div>
                        {/* Sticky top bar */}
                        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm px-6 py-3 flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-base font-bold text-gray-900 truncate">{selectedPaper.session_label}</h2>
                                    {sourcePdfPath && (
                                        <a href={`/api/pdf?path=${encodeURIComponent(sourcePdfPath)}`} target="_blank" rel="noopener noreferrer"
                                            className="text-blue-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded shadow-sm text-xs flex-shrink-0" title={sourcePdfPath}>
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-gray-500">
                                                <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" />
                                                <path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" />
                                            </svg>
                                            <span className="truncate max-w-[150px]">Source PDF</span>
                                        </a>
                                    )}
                                </div>
                                <p className="text-xs text-gray-500">{selectedPaper.subject} &middot; {formatDate(selectedPaper.paper_date)} &middot; {filteredQuestions.length} showing</p>
                            </div>
                            {feedback && (
                                <div className={`text-sm px-3 py-1.5 rounded font-medium ${feedback.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                                    {feedback.message}
                                </div>
                            )}
                            <div className="flex gap-1 flex-shrink-0">
                                {['unsolved', 'all', 'solved'].map(f => (
                                    <button key={f} onClick={() => setFilter(f)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${filter === f ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
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
                                        subtype={subtypes[q.question_id] || ''}
                                        onSubtypeChange={(val) => setSubtypes(prev => ({ ...prev, [q.question_id]: val }))}
                                        difficulty={difficulties[q.question_id] || ''}
                                        onDifficultyChange={(val) => setDifficulties(prev => ({ ...prev, [q.question_id]: val }))}
                                        solutionEn={solutionsEn[q.question_id] || ''}
                                        onSolutionEnChange={(val) => setSolutionsEn(prev => ({ ...prev, [q.question_id]: val }))}
                                        solutionHi={solutionsHi[q.question_id] || ''}
                                        onSolutionHiChange={(val) => setSolutionsHi(prev => ({ ...prev, [q.question_id]: val }))}
                                        aiResult={aiResults[q.question_id]}
                                        isGenerating={generatingId === q.question_id}
                                        isTranslating={translatingId === q.question_id}
                                        isSaving={savingId === q.question_id}
                                        isFlagging={flaggingId === q.question_id}
                                        onTranslate={() => handleTranslate(q.question_id)}
                                        onGenerate={() => handleGenerate(q)}
                                        onSave={() => handleSave(q)}
                                        onFlag={() => handleFlag(q)}
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

function QuestionCard({ q, idx, selectedOption, onSelectOption, subtype, onSubtypeChange, difficulty, onDifficultyChange, solutionEn, onSolutionEnChange, solutionHi, onSolutionHiChange, aiResult, isGenerating, isTranslating, isSaving, isFlagging, onTranslate, onGenerate, onSave, onFlag, extractImages }) {
    const isSolved = !!q.answer_label || !!q.correct_option_label || q.solution_status === 'DONE';
    const isFlagged = q.status === 'FLAGGED';
    const images = extractImages(q.question_text);

    return (
        <div className={`bg-white rounded-lg border shadow-sm overflow-hidden ${isFlagged ? 'border-red-300' : isSolved ? 'border-green-300' : 'border-gray-200'}`}>
            {/* Header */}
            <div className={`px-5 py-3 border-b flex items-center justify-between ${isFlagged ? 'bg-red-50 border-red-200' : isSolved ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'}`}>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-700">Q.{q.source_q_no || idx + 1}</span>
                    <span className="text-xs text-gray-400 font-mono">{q.question_id.slice(0, 8)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isFlagged ? 'bg-red-100 text-red-700' : isSolved ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {isFlagged ? 'Flagged' : isSolved ? 'Solved' : q.status || 'MANUALLY_CORRECTED'}
                    </span>
                    <DifficultyBadge level={q.difficulty || (difficulty ? difficultyToInt[difficulty] : null) || aiResult?.difficulty} />
                    {q.section_code && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{q.section_code}</span>}
                </div>
                <button onClick={onFlag} disabled={isFlagging || isFlagged}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:opacity-50 transition-colors">
                    {isFlagging ? 'Flagging...' : isFlagged ? 'Flagged' : 'Flag'}
                </button>
            </div>

            {/* Question body */}
            <div className="px-5 py-4 border-b border-gray-100">
                {images.length === 0 && q.assets?.length > 0 && (
                    <div className="flex flex-wrap gap-3 mb-3">
                        {q.assets.filter(a => a.role === 'question' || !a.option_key).map((asset, i) => (
                            <img key={i} src={asset.image_url} alt={`Q.${q.source_q_no || idx + 1} asset`}
                                className="max-h-48 rounded border border-gray-200 bg-white object-contain" />
                        ))}
                    </div>
                )}
                <div className="text-sm text-gray-800"><Latex>{q.question_text || '(No question text)'}</Latex></div>
            </div>

            {/* Options */}
            <div className="px-5 py-4 border-b border-gray-100">
                <div className="grid grid-cols-4 gap-3">
                    {(q.options || []).map(opt => {
                        const isSelected = selectedOption === opt.opt_label;
                        const optAsset = q.assets?.find(a => a.option_key === opt.opt_label);
                        const textWithoutImages = (opt.opt_text || '').replace(/\\includegraphics\{[^}]+\}/g, '').trim();
                        return (
                            <button key={opt.opt_label} onClick={() => onSelectOption(opt.opt_label)}
                                className={`flex flex-col items-center justify-center p-3 rounded-lg border text-center transition-all min-h-[5rem] ${isSelected
                                    ? 'bg-green-50 border-green-400 ring-2 ring-green-300'
                                    : 'bg-white border-gray-200 hover:border-gray-400 hover:bg-gray-50'}`}>
                                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border mb-2 flex-shrink-0 ${isSelected
                                    ? 'bg-green-500 text-white border-green-500'
                                    : 'bg-gray-100 text-gray-600 border-gray-300'}`}>{opt.opt_label}</span>
                                {optAsset ? (
                                    <img src={optAsset.image_url} alt={`Option ${opt.opt_label}`} className="max-h-24 object-contain mb-1" />
                                ) : opt.opt_text ? (
                                    <div className="text-xs text-gray-700 break-words w-full"><Latex>{opt.opt_text}</Latex></div>
                                ) : null}
                                {optAsset && textWithoutImages && (
                                    <div className="text-xs text-gray-700 break-words w-full mt-1"><Latex>{textWithoutImages}</Latex></div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Subtype + Difficulty */}
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                <div className="flex flex-wrap gap-6">
                    <div>
                        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-2">Subtype</label>
                        <div className="flex flex-wrap gap-1.5">
                            {SUBTYPES.map(st => (
                                <button key={st.key} onClick={() => onSubtypeChange(st.key)}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${subtype === st.key
                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                        : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'}`}>
                                    {st.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-2">Difficulty</label>
                        <div className="flex gap-1.5">
                            {DIFFICULTIES.map(d => (
                                <button key={d.key} onClick={() => onDifficultyChange(d.key)}
                                    className={`px-4 py-1.5 text-xs font-semibold rounded-md border transition-colors ${difficulty === d.key ? d.active : d.cls}`}>
                                    {d.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Solution textboxes EN / HI with translate */}
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200 border-b border-gray-100">
                <div className="p-5">
                    <label className="text-xs font-semibold text-blue-600 uppercase tracking-wide block mb-1.5">English Explanation</label>
                    <textarea rows={3} value={solutionEn} onChange={e => onSolutionEnChange(e.target.value)}
                        placeholder="Write the solution explanation in English..."
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-y" />
                </div>
                <div className="p-5">
                    <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-orange-600 uppercase tracking-wide">Hindi Explanation</label>
                        <button onClick={onTranslate} disabled={isTranslating || !solutionEn}
                            className="px-3 py-1 text-xs font-semibold rounded-md bg-orange-100 text-orange-700 border border-orange-200 hover:bg-orange-200 disabled:opacity-50 transition-colors">
                            {isTranslating ? 'Translating...' : 'Translate EN \u2192 HI'}
                        </button>
                    </div>
                    <textarea rows={3} value={solutionHi} onChange={e => onSolutionHiChange(e.target.value)}
                        placeholder="Hindi translation will appear here (editable)..."
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-y" />
                </div>
            </div>

            {/* AI Result preview */}
            {aiResult?.full_json && (
                <div className="px-5 py-3 border-b border-gray-100">
                    <div className="flex items-center gap-4 p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm">
                        <div>
                            <span className="text-xs text-gray-500 uppercase">Answer</span>
                            <div className="text-lg font-bold text-blue-800">{aiResult.correct_option_label || '?'}</div>
                        </div>
                        <div>
                            <span className="text-xs text-gray-500 uppercase">Difficulty</span>
                            <div><DifficultyBadge level={aiResult.difficulty} /></div>
                        </div>
                        {aiResult.full_json.question_identity?.subtype && (
                            <div>
                                <span className="text-xs text-gray-500 uppercase">Subtype</span>
                                <div className="text-sm font-medium text-gray-700">{aiResult.full_json.question_identity.subtype}</div>
                            </div>
                        )}
                        {aiResult.full_json.answer_outcome?.core_answer_basis && (
                            <div className="flex-1">
                                <span className="text-xs text-gray-500 uppercase">Core Basis</span>
                                <div className="text-xs text-gray-700">{aiResult.full_json.answer_outcome.core_answer_basis}</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Action buttons */}
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                <div className="text-xs text-gray-500">
                    {selectedOption && <span>Answer: <strong>{selectedOption}</strong></span>}
                    {subtype && <span className="ml-3">Type: <strong>{subtype}</strong></span>}
                    {difficulty && <span className="ml-3">Diff: <strong>{difficulty}</strong></span>}
                </div>
                <div className="flex gap-2">
                    <button onClick={onGenerate} disabled={isGenerating || !selectedOption}
                        className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                        {isGenerating ? (<><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>Generating...</>) : 'Generate AI'}
                    </button>
                    <button onClick={onSave} disabled={isSaving || !selectedOption || !aiResult}
                        className="px-5 py-2 bg-orange-600 text-white text-sm font-semibold rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                        {isSaving ? (<><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>Saving...</>) : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}
