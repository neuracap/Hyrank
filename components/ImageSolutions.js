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

export default function ImageSolutions({ papers, sections = [] }) {
    const [selectedPaperId, setSelectedPaperId] = useState('');
    const [selectedSection, setSelectedSection] = useState('ALL');
    const [solvedFilter, setSolvedFilter] = useState('unsolved');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
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

    const fetchQuestions = async (paperId, section, solved, page) => {
        setQuestions([]);
        setSelectedOptions({});
        setSubtypes({});
        setDifficulties({});
        setSolutionsEn({});
        setSolutionsHi({});
        setAiResults({});
        setSourcePdfPath(null);
        setFeedback(null);
        setLoadingQuestions(true);

        try {
            const params = new URLSearchParams();
            if (paperId) params.set('paperId', paperId);
            if (section && section !== 'ALL') params.set('section', section);
            params.set('solved', solved);
            params.set('page', page);
            params.set('limit', '100');

            const res = await fetch(`/api/image-solutions/questions?${params.toString()}`);
            const data = await res.json();
            if (res.ok && data.questions) {
                setQuestions(data.questions);
                setTotalPages(data.totalPages || 0);
                setTotalCount(data.total || 0);
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

    const handleFilterChange = (paperId, section, solved, page) => {
        setSelectedPaperId(paperId);
        setSelectedSection(section);
        setSolvedFilter(solved);
        setCurrentPage(page);
        fetchQuestions(paperId, section, solved, page);
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

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Top Filter Bar */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm px-4 py-2 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-lg font-bold text-gray-900 flex-shrink-0">Image Solutions</h1>

                    <select value={selectedPaperId}
                        onChange={e => handleFilterChange(e.target.value, selectedSection, solvedFilter, 1)}
                        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm min-w-[250px]">
                        <option value="">All Papers</option>
                        {papers.map(p => (
                            <option key={p.paper_session_id} value={p.paper_session_id}>
                                {p.session_label} ({parseInt(p.solved_count||0)}/{parseInt(p.image_count||0)})
                            </option>
                        ))}
                    </select>

                    <select value={selectedSection}
                        onChange={e => handleFilterChange(selectedPaperId, e.target.value, solvedFilter, 1)}
                        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm">
                        <option value="ALL">All Sections</option>
                        {sections.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>

                    <div className="flex gap-1">
                        {['unsolved', 'all', 'solved'].map(f => (
                            <button key={f} onClick={() => handleFilterChange(selectedPaperId, selectedSection, f, 1)}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${solvedFilter === f ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                {f.charAt(0).toUpperCase() + f.slice(1)}
                            </button>
                        ))}
                    </div>

                    {totalCount > 0 && <span className="text-xs text-gray-500">{totalCount} questions</span>}

                    {sourcePdfPath && (
                        <a href={`/api/pdf?path=${encodeURIComponent(sourcePdfPath)}`} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-red-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-0.5 rounded">
                            PDF
                        </a>
                    )}

                    {feedback && (
                        <span className={`text-sm px-3 py-1.5 rounded font-medium ${feedback.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                            {feedback.message}
                        </span>
                    )}
                </div>
            </div>

            {/* Questions */}
            <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
                {loadingQuestions ? (
                    <div className="flex items-center justify-center py-24">
                        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full"></div>
                        <span className="ml-3 text-gray-500">Loading image questions...</span>
                    </div>
                ) : questions.length === 0 && (selectedPaperId || selectedSection !== 'ALL') ? (
                    <div className="text-center py-24 text-gray-400">No image questions found for the selected filters.</div>
                ) : questions.length === 0 ? (
                    <div className="text-center py-24 text-gray-400">
                        Select filters above or click a solved/unsolved filter to load questions.
                    </div>
                ) : (
                    <>
                        {questions.map((q, idx) => (
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
                        ))}

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-center gap-2 py-4">
                                <button onClick={() => handleFilterChange(selectedPaperId, selectedSection, solvedFilter, currentPage - 1)}
                                    disabled={currentPage <= 1}
                                    className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">
                                    Previous
                                </button>
                                <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
                                <button onClick={() => handleFilterChange(selectedPaperId, selectedSection, solvedFilter, currentPage + 1)}
                                    disabled={currentPage >= totalPages}
                                    className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">
                                    Next
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
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
                        // Only show separate asset image when option text is empty and has no embedded images
                        const textHasImage = /\\includegraphics|!\[/.test(opt.opt_text || '');
                        const showAssetImg = optAsset?.image_url && !textHasImage && !(opt.opt_text || '').trim();
                        return (
                            <button key={opt.opt_label} onClick={() => onSelectOption(opt.opt_label)}
                                className={`flex flex-col items-center justify-center p-3 rounded-lg border text-center transition-all min-h-[5rem] ${isSelected
                                    ? 'bg-green-50 border-green-400 ring-2 ring-green-300'
                                    : 'bg-white border-gray-200 hover:border-gray-400 hover:bg-gray-50'}`}>
                                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border mb-2 flex-shrink-0 ${isSelected
                                    ? 'bg-green-500 text-white border-green-500'
                                    : 'bg-gray-100 text-gray-600 border-gray-300'}`}>{opt.opt_label}</span>
                                {showAssetImg && (
                                    <img src={optAsset.image_url} alt={`Option ${opt.opt_label}`} className="max-h-24 object-contain mb-1" />
                                )}
                                {opt.opt_text ? (
                                    <div className="text-xs text-gray-700 break-words w-full"><Latex>{opt.opt_text}</Latex></div>
                                ) : null}
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
