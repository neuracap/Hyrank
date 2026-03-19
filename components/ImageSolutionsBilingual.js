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

function DifficultyBadge({ level }) {
    if (!level) return null;
    const map = { 1: ['Easy', 'bg-green-100 text-green-700'], 2: ['Medium', 'bg-yellow-100 text-yellow-700'], 3: ['Hard', 'bg-red-100 text-red-700'] };
    const [label, cls] = map[level] || ['?', 'bg-gray-100 text-gray-600'];
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

const difficultyToInt = { easy: 1, medium: 2, hard: 3 };

export default function ImageSolutionsBilingual({ papers }) {
    const [selectedPaper, setSelectedPaper] = useState(null);
    const [pairs, setPairs] = useState([]);
    const [sourcePdfPath, setSourcePdfPath] = useState(null);
    const [loadingPairs, setLoadingPairs] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [filter, setFilter] = useState('unsolved');

    // Per-pair state — separate EN/HI option selections (options can be shuffled)
    const [selectedOptionsEn, setSelectedOptionsEn] = useState({});
    const [selectedOptionsHi, setSelectedOptionsHi] = useState({});
    const [subtypes, setSubtypes] = useState({});
    const [difficulties, setDifficulties] = useState({});
    const [solutionsEn, setSolutionsEn] = useState({});
    const [solutionsHi, setSolutionsHi] = useState({});
    const [aiResultsEn, setAiResultsEn] = useState({});
    const [aiResultsHi, setAiResultsHi] = useState({});
    const [generatingId, setGeneratingId] = useState(null);
    const [translatingId, setTranslatingId] = useState(null);
    const [savingId, setSavingId] = useState(null);
    const [flaggingId, setFlaggingId] = useState(null);

    const handlePaperClick = async (paper) => {
        setSelectedPaper(paper);
        setPairs([]);
        setSourcePdfPath(null);
        setSelectedOptionsEn({});
        setSelectedOptionsHi({});
        setSubtypes({});
        setDifficulties({});
        setSolutionsEn({});
        setSolutionsHi({});
        setAiResultsEn({});
        setAiResultsHi({});
        setFeedback(null);
        setLoadingPairs(true);

        try {
            const res = await fetch(`/api/image-solutions-bilingual/questions?paperId=${paper.paper_session_id}`);
            const data = await res.json();
            if (res.ok && data.pairs) {
                setPairs(data.pairs);
                if (data.source_pdf_path) setSourcePdfPath(data.source_pdf_path);
                const optsEn = {}, optsHi = {}, subs = {}, diffs = {}, solEn = {}, solHi = {}, resEn = {}, resHi = {};
                for (const p of data.pairs) {
                    // EN correct option from eng solution
                    const enLabel = p.correct_option_label || p.eng_solution_json?.answer_outcome?.correct_option || p.eng_solution_json?.correct_option_label;
                    if (enLabel) optsEn[p.link_id] = enLabel;
                    // HI correct option from hin solution (may differ due to shuffled options)
                    const hiLabel = p.hin_solution_json?.answer_outcome?.correct_option || p.hin_solution_json?.correct_option_label || enLabel;
                    if (hiLabel) optsHi[p.link_id] = hiLabel;
                    if (p.subtype) subs[p.link_id] = p.subtype;
                    if (p.difficulty) {
                        const diffMap = { 1: 'easy', 2: 'medium', 3: 'hard' };
                        diffs[p.link_id] = diffMap[p.difficulty] || '';
                    }
                    // Pre-populate from saved EN solution
                    if (p.eng_solution_json?.display_sections) {
                        const ds = p.eng_solution_json.display_sections;
                        if (Array.isArray(ds)) {
                            const ec = ds.find(s => s.key === 'exam_craft');
                            if (ec?.content) solEn[p.link_id] = ec.content;
                        } else if (ds.exam_craft?.approach) {
                            solEn[p.link_id] = ds.exam_craft.approach;
                        }
                        resEn[p.link_id] = { full_json: p.eng_solution_json, correct_option_label: enLabel, difficulty: p.difficulty, subtype: p.subtype };
                    }
                    if (p.hin_solution_json?.display_sections) {
                        const ds = p.hin_solution_json.display_sections;
                        if (Array.isArray(ds)) {
                            const ec = ds.find(s => s.key === 'exam_craft');
                            if (ec?.content) solHi[p.link_id] = ec.content;
                        } else if (ds.exam_craft?.approach_hi) {
                            solHi[p.link_id] = ds.exam_craft.approach_hi;
                        } else if (ds.exam_craft?.approach) {
                            solHi[p.link_id] = ds.exam_craft.approach;
                        }
                        resHi[p.link_id] = { full_json: p.hin_solution_json, correct_option_label: hiLabel, difficulty: p.difficulty, subtype: p.subtype };
                    }
                }
                setSelectedOptionsEn(optsEn);
                setSelectedOptionsHi(optsHi);
                setSubtypes(subs);
                setDifficulties(diffs);
                setSolutionsEn(solEn);
                setSolutionsHi(solHi);
                setAiResultsEn(resEn);
                setAiResultsHi(resHi);
            } else {
                setFeedback({ type: 'error', message: data.error || 'Failed to load pairs.' });
            }
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error loading pairs.' });
        } finally {
            setLoadingPairs(false);
        }
    };

    const handleTranslate = useCallback(async (linkId) => {
        const text = solutionsEn[linkId];
        if (!text) { setFeedback({ type: 'error', message: 'Write the English explanation first.' }); return; }
        setTranslatingId(linkId);
        try {
            const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, source: 'en', target: 'hi' }),
            });
            const data = await res.json();
            if (res.ok && data.translatedText) {
                setSolutionsHi(prev => ({ ...prev, [linkId]: data.translatedText }));
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

    const handleGenerate = useCallback(async (pair) => {
        const linkId = pair.link_id;
        const enAnswer = selectedOptionsEn[linkId];
        const hiAnswer = selectedOptionsHi[linkId];
        if (!enAnswer) { setFeedback({ type: 'error', message: 'Select the correct English answer first.' }); return; }
        if (pair.hin_id && !hiAnswer) { setFeedback({ type: 'error', message: 'Select the correct Hindi answer first.' }); return; }
        const sub = subtypes[linkId] || 'other';
        const diff = difficulties[linkId] || 'medium';

        setGeneratingId(linkId);
        setFeedback(null);

        try {
            // Make 2 parallel AI calls: EN and HI with their respective correct options
            const [enRes, hiRes] = await Promise.all([
                fetch('/api/image-solutions-bilingual/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        question_id: pair.eng_id,
                        language: 'EN',
                        question_text: pair.eng_text,
                        options: pair.eng_options,
                        correct_option: enAnswer,
                        subtype: sub,
                        difficulty: diff,
                        exam_craft: solutionsEn[linkId] || '',
                    }),
                }),
                pair.hin_id ? fetch('/api/image-solutions-bilingual/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        question_id: pair.hin_id,
                        language: 'HI',
                        question_text: pair.hin_text,
                        options: pair.hin_options,
                        correct_option: hiAnswer,
                        subtype: sub,
                        difficulty: diff,
                        exam_craft: solutionsHi[linkId] || '',
                    }),
                }) : Promise.resolve(null),
            ]);

            const enData = await enRes.json();
            if (enRes.ok && enData.success) {
                setAiResultsEn(prev => ({ ...prev, [linkId]: enData.parsed }));
            } else {
                setFeedback({ type: 'error', message: `EN AI failed: ${enData.error || 'Unknown error'}` });
                setGeneratingId(null);
                return;
            }

            if (hiRes) {
                const hiData = await hiRes.json();
                if (hiRes.ok && hiData.success) {
                    setAiResultsHi(prev => ({ ...prev, [linkId]: hiData.parsed }));
                } else {
                    setFeedback({ type: 'error', message: `HI AI failed: ${hiData.error || 'Unknown error'}` });
                    setGeneratingId(null);
                    return;
                }
            }

            setFeedback({ type: 'success', message: `AI enrichment done for Q.${pair.eng_source_no || linkId}` });
        } catch (err) {
            console.error(err);
            setFeedback({ type: 'error', message: 'Network error during AI generation.' });
        } finally {
            setGeneratingId(null);
        }
    }, [selectedOptionsEn, selectedOptionsHi, subtypes, difficulties, solutionsEn, solutionsHi]);

    const handleSave = useCallback(async (pair) => {
        const linkId = pair.link_id;
        const enAnswer = selectedOptionsEn[linkId];
        const hiAnswer = selectedOptionsHi[linkId];
        const enResult = aiResultsEn[linkId];

        if (!enAnswer) { setFeedback({ type: 'error', message: 'Select the correct English answer first.' }); return; }
        if (!enResult) { setFeedback({ type: 'error', message: 'Generate AI enrichment first.' }); return; }

        const diff = difficulties[linkId];
        const diffInt = diff ? difficultyToInt[diff] : null;

        setSavingId(linkId);
        setFeedback(null);
        try {
            const res = await fetch('/api/image-solutions-bilingual/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    eng_id: pair.eng_id,
                    eng_version: pair.eng_version,
                    hin_id: pair.hin_id,
                    hin_version: pair.hin_version,
                    link_id: pair.link_id,
                    subtype: subtypes[linkId] || 'other',
                    difficulty: diffInt,
                    parsed_en: { ...enResult, correct_option_label: enAnswer },
                    parsed_hi: aiResultsHi[linkId] ? { ...aiResultsHi[linkId], correct_option_label: hiAnswer || enAnswer } : null,
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', message: `Q.${pair.eng_source_no || linkId} saved!` });
                setPairs(prev => prev.map(p =>
                    p.link_id === linkId ? { ...p, solution_status: 'DONE', correct_option_label: enAnswer, difficulty: diffInt } : p
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
    }, [aiResultsEn, aiResultsHi, selectedOptionsEn, selectedOptionsHi, subtypes, difficulties]);

    const handleFlag = useCallback(async (pair) => {
        setFlaggingId(pair.link_id);
        setFeedback(null);
        try {
            const res = await fetch('/api/image-solutions-bilingual/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    eng_id: pair.eng_id, eng_version: pair.eng_version,
                    hin_id: pair.hin_id, hin_version: pair.hin_version,
                    link_id: pair.link_id, action: 'flag',
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', message: `Q.${pair.eng_source_no || pair.link_id} flagged.` });
                setPairs(prev => prev.map(p => p.link_id === pair.link_id ? { ...p, link_status: 'FLAGGED' } : p));
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

    const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';

    const filteredPairs = pairs.filter(p => {
        if (p.link_status === 'FLAGGED') return filter === 'all';
        if (filter === 'unsolved') return p.solution_status !== 'DONE';
        if (filter === 'solved') return p.solution_status === 'DONE';
        return true;
    });

    return (
        <div className="flex h-screen overflow-hidden bg-white">
            {/* Sidebar */}
            <aside className="w-72 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
                <div className="px-4 py-4 border-b border-gray-200">
                    <h1 className="text-lg font-bold text-gray-900">Bilingual Img Sol</h1>
                    <p className="text-xs text-gray-500 mt-0.5">{papers.length} papers</p>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {papers.length === 0 ? (
                        <div className="p-4 text-sm text-gray-400 italic text-center mt-8">No papers found.</div>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {papers.map(paper => {
                                const isSelected = selectedPaper?.paper_session_id === paper.paper_session_id;
                                const total = parseInt(paper.pair_count || 0);
                                const solved = parseInt(paper.solved_count || 0);
                                const allDone = total > 0 && solved === total;
                                return (
                                    <li key={paper.paper_session_id}>
                                        <button onClick={() => handlePaperClick(paper)}
                                            className={`w-full text-left px-4 py-3 transition-colors hover:bg-indigo-50 ${isSelected ? 'bg-indigo-100 border-l-4 border-indigo-500' : 'border-l-4 border-transparent'}`}>
                                            <div className="text-sm font-semibold text-gray-900 truncate">{paper.session_label}</div>
                                            {paper.exam_name && <div className="text-xs text-indigo-600 mt-0.5 truncate">{paper.exam_name}</div>}
                                            <div className="flex items-center justify-between mt-1">
                                                <span className="text-xs text-gray-400">{formatDate(paper.paper_date)}</span>
                                                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${allDone ? 'bg-green-100 text-green-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                                    {solved}/{total}
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

            {/* Main */}
            <main className="flex-1 overflow-y-auto bg-gray-50">
                {!selectedPaper ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <h2 className="text-xl font-semibold text-gray-700">Select a paper</h2>
                            <p className="text-gray-400 mt-2 text-sm">Choose a paper to review bilingual image questions.</p>
                        </div>
                    </div>
                ) : (
                    <div>
                        {/* Top bar */}
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
                                <p className="text-xs text-gray-500">{selectedPaper.exam_name} &middot; {formatDate(selectedPaper.paper_date)} &middot; {filteredPairs.length} showing</p>
                            </div>
                            {feedback && (
                                <div className={`text-sm px-3 py-1.5 rounded font-medium ${feedback.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                                    {feedback.message}
                                </div>
                            )}
                            <div className="flex gap-1 flex-shrink-0">
                                {['unsolved', 'all', 'solved'].map(f => (
                                    <button key={f} onClick={() => setFilter(f)}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                        {f.charAt(0).toUpperCase() + f.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Pairs */}
                        <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">
                            {loadingPairs ? (
                                <div className="flex items-center justify-center py-24">
                                    <div className="animate-spin w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full"></div>
                                    <span className="ml-3 text-gray-500">Loading bilingual pairs...</span>
                                </div>
                            ) : filteredPairs.length === 0 ? (
                                <div className="text-center py-24 text-gray-400">
                                    {filter === 'unsolved' ? 'All pairs solved!' : 'No pairs found.'}
                                </div>
                            ) : (
                                filteredPairs.map((pair, idx) => (
                                    <PairCard
                                        key={pair.link_id}
                                        pair={pair}
                                        idx={idx}
                                        selectedOptionEn={selectedOptionsEn[pair.link_id]}
                                        onSelectOptionEn={(label) => setSelectedOptionsEn(prev => ({ ...prev, [pair.link_id]: label }))}
                                        selectedOptionHi={selectedOptionsHi[pair.link_id]}
                                        onSelectOptionHi={(label) => setSelectedOptionsHi(prev => ({ ...prev, [pair.link_id]: label }))}
                                        subtype={subtypes[pair.link_id] || ''}
                                        onSubtypeChange={(val) => setSubtypes(prev => ({ ...prev, [pair.link_id]: val }))}
                                        difficulty={difficulties[pair.link_id] || ''}
                                        onDifficultyChange={(val) => setDifficulties(prev => ({ ...prev, [pair.link_id]: val }))}
                                        solutionEn={solutionsEn[pair.link_id] || ''}
                                        onSolutionEnChange={(val) => setSolutionsEn(prev => ({ ...prev, [pair.link_id]: val }))}
                                        solutionHi={solutionsHi[pair.link_id] || ''}
                                        onSolutionHiChange={(val) => setSolutionsHi(prev => ({ ...prev, [pair.link_id]: val }))}
                                        aiResultEn={aiResultsEn[pair.link_id]}
                                        aiResultHi={aiResultsHi[pair.link_id]}
                                        isGenerating={generatingId === pair.link_id}
                                        isTranslating={translatingId === pair.link_id}
                                        isSaving={savingId === pair.link_id}
                                        isFlagging={flaggingId === pair.link_id}
                                        onTranslate={() => handleTranslate(pair.link_id)}
                                        onGenerate={() => handleGenerate(pair)}
                                        onSave={() => handleSave(pair)}
                                        onFlag={() => handleFlag(pair)}
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

function OptionGrid({ options, assets, selectedOption, onSelect }) {
    return (
        <div className="grid grid-cols-4 gap-2">
            {(options || []).map(opt => {
                const isSelected = selectedOption === opt.opt_label;
                const optAsset = assets?.find(a => a.option_key === opt.opt_label);
                const textWithoutImages = (opt.opt_text || '').replace(/\\includegraphics\{[^}]+\}/g, '').trim();
                return (
                    <button key={opt.opt_label} onClick={() => onSelect(opt.opt_label)}
                        className={`flex flex-col items-center p-2 rounded-lg border text-center transition-all ${isSelected
                            ? 'bg-green-50 border-green-400 ring-2 ring-green-300'
                            : 'bg-white border-gray-200 hover:border-gray-400'}`}>
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border mb-1 ${isSelected
                            ? 'bg-green-500 text-white border-green-500'
                            : 'bg-gray-100 text-gray-600 border-gray-300'}`}>{opt.opt_label}</span>
                        {optAsset ? (
                            <img src={optAsset.image_url} alt={`Option ${opt.opt_label}`} className="max-h-16 object-contain" />
                        ) : opt.opt_text ? (
                            <div className="text-xs text-gray-700 break-words w-full"><Latex>{opt.opt_text}</Latex></div>
                        ) : null}
                        {optAsset && textWithoutImages && (
                            <div className="text-xs text-gray-700 break-words w-full mt-0.5"><Latex>{textWithoutImages}</Latex></div>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

function PairCard({ pair, idx, selectedOptionEn, onSelectOptionEn, selectedOptionHi, onSelectOptionHi, subtype, onSubtypeChange, difficulty, onDifficultyChange, solutionEn, onSolutionEnChange, solutionHi, onSolutionHiChange, aiResultEn, aiResultHi, isGenerating, isTranslating, isSaving, isFlagging, onTranslate, onGenerate, onSave, onFlag }) {
    const isSolved = pair.solution_status === 'DONE';
    const isFlagged = pair.link_status === 'FLAGGED';

    return (
        <div className={`bg-white rounded-lg border shadow-sm overflow-hidden ${isFlagged ? 'border-red-300' : isSolved ? 'border-green-300' : 'border-gray-200'}`}>
            {/* Header */}
            <div className={`px-5 py-3 border-b flex items-center justify-between ${isFlagged ? 'bg-red-50 border-red-200' : isSolved ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'}`}>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-700">Q.{pair.eng_source_no || idx + 1}</span>
                    <span className="text-xs text-gray-400 font-mono">{pair.eng_id.slice(0, 8)}</span>
                    {isSolved && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">Solved</span>}
                    {isFlagged && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">Flagged</span>}
                    <DifficultyBadge level={pair.difficulty || (difficulty ? difficultyToInt[difficulty] : null)} />
                    {pair.section_code && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{pair.section_code}</span>}
                </div>
                <button onClick={onFlag} disabled={isFlagging || isFlagged}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:opacity-50 transition-colors">
                    {isFlagging ? 'Flagging...' : isFlagged ? 'Flagged' : 'Flag'}
                </button>
            </div>

            {/* Side-by-side EN / HI */}
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
                {/* English */}
                <div className="p-5 space-y-3">
                    <div className="text-xs font-bold text-blue-600 uppercase tracking-wide">English</div>
                    <div className="text-sm text-gray-800"><Latex>{pair.eng_text || '(No text)'}</Latex></div>
                    {pair.eng_assets?.filter(a => a.role === 'question' || !a.option_key).length > 0 && !pair.eng_text?.includes('\\includegraphics') && (
                        <div className="flex flex-wrap gap-2">
                            {pair.eng_assets.filter(a => a.role === 'question' || !a.option_key).map((a, i) => (
                                <img key={i} src={a.image_url} alt="EN figure" className="max-h-40 rounded border border-gray-200 object-contain" />
                            ))}
                        </div>
                    )}
                    <OptionGrid options={pair.eng_options} assets={pair.eng_assets} selectedOption={selectedOptionEn} onSelect={onSelectOptionEn} />
                </div>
                {/* Hindi */}
                <div className="p-5 space-y-3">
                    <div className="text-xs font-bold text-orange-600 uppercase tracking-wide">Hindi</div>
                    <div className="text-sm text-gray-800"><Latex>{pair.hin_text || '(No Hindi text)'}</Latex></div>
                    {pair.hin_assets?.filter(a => a.role === 'question' || !a.option_key).length > 0 && !pair.hin_text?.includes('\\includegraphics') && (
                        <div className="flex flex-wrap gap-2">
                            {pair.hin_assets.filter(a => a.role === 'question' || !a.option_key).map((a, i) => (
                                <img key={i} src={a.image_url} alt="HI figure" className="max-h-40 rounded border border-gray-200 object-contain" />
                            ))}
                        </div>
                    )}
                    <OptionGrid options={pair.hin_options} assets={pair.hin_assets} selectedOption={selectedOptionHi} onSelect={onSelectOptionHi} />
                </div>
            </div>

            {/* Subtype + Difficulty selection */}
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
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

            {/* Solution textboxes EN / HI */}
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200 border-t border-gray-100">
                <div className="p-5">
                    <label className="text-xs font-semibold text-blue-600 uppercase tracking-wide block mb-1.5">English Explanation</label>
                    <textarea rows={3} value={solutionEn} onChange={e => onSolutionEnChange(e.target.value)}
                        placeholder="Write the solution explanation in English..."
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-y" />
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
            {(aiResultEn || aiResultHi) && (
                <div className="px-5 py-3 border-t border-gray-100">
                    <div className="flex items-center gap-4 p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm">
                        <div>
                            <span className="text-xs text-gray-500 uppercase">Answer</span>
                            <div className="text-lg font-bold text-blue-800">{aiResultEn?.correct_option_label || '?'}</div>
                        </div>
                        <div>
                            <span className="text-xs text-gray-500 uppercase">Difficulty</span>
                            <div><DifficultyBadge level={aiResultEn?.difficulty} /></div>
                        </div>
                        {aiResultEn?.full_json?.question_identity?.subtype && (
                            <div>
                                <span className="text-xs text-gray-500 uppercase">Subtype</span>
                                <div className="text-sm font-medium text-gray-700">{aiResultEn.full_json.question_identity.subtype}</div>
                            </div>
                        )}
                        {aiResultEn?.full_json?.answer_outcome?.core_answer_basis && (
                            <div className="flex-1">
                                <span className="text-xs text-gray-500 uppercase">Core Basis</span>
                                <div className="text-xs text-gray-700">{aiResultEn.full_json.answer_outcome.core_answer_basis}</div>
                            </div>
                        )}
                        {aiResultHi && <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded font-semibold">HI OK</span>}
                    </div>
                </div>
            )}

            {/* Action buttons */}
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                <div className="text-xs text-gray-500">
                    {selectedOptionEn && <span>EN: <strong>{selectedOptionEn}</strong></span>}
                    {selectedOptionHi && <span className="ml-2">HI: <strong>{selectedOptionHi}</strong></span>}
                    {subtype && <span className="ml-3">Type: <strong>{subtype}</strong></span>}
                    {difficulty && <span className="ml-3">Diff: <strong>{difficulty}</strong></span>}
                </div>
                <div className="flex gap-2">
                    <button onClick={onGenerate} disabled={isGenerating || !selectedOptionEn}
                        className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                        {isGenerating ? (<><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>Generating...</>) : 'Generate AI'}
                    </button>
                    <button onClick={onSave} disabled={isSaving || !selectedOptionEn || !aiResultEn}
                        className="px-5 py-2 bg-orange-600 text-white text-sm font-semibold rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                        {isSaving ? (<><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>Saving...</>) : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}
