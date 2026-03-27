'use client';

import { useState } from 'react';
import Latex from '@/components/Latex';

const DIFF_LABELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const DIFF_COLORS = { 1: 'bg-green-100 text-green-700', 2: 'bg-yellow-100 text-yellow-700', 3: 'bg-red-100 text-red-700' };

function toArray(v) { return Array.isArray(v) ? v : []; }

// Format text by adding line breaks after sentences
function formatSentences(text) {
    if (!text) return text;
    const latexBlocks = [];
    let p = text.replace(/\$[^$]+\$/g, (m) => { latexBlocks.push(m); return `__LATEX_${latexBlocks.length - 1}__`; });
    const secTags = [];
    p = p.replace(/\[[a-z_]+\]/g, (m) => { secTags.push(m); return `__SEC_${secTags.length - 1}__`; });
    p = p.replace(/\.(\s+)(?=[A-Z\u0900-\u097F])/g, '.\n');
    p = p.replace(/।\s*/g, '।\n');
    p = p.replace(/\n{3,}/g, '\n\n');
    for (let i = 0; i < latexBlocks.length; i++) p = p.replace(`__LATEX_${i}__`, latexBlocks[i]);
    for (let i = 0; i < secTags.length; i++) p = p.replace(`__SEC_${i}__`, secTags[i]);
    return p;
}

// Get correct answer label from various sources
function getCorrectLabel(side) {
    if (!side) return null;
    if (side.correct) return side.correct;
    const sj = side.solution_json || {};
    if (sj.answer_outcome?.correct_option) return sj.answer_outcome.correct_option;
    if (sj.correct_option_label) return sj.correct_option_label;
    const correctOpt = (side.options || []).find(o => o.is_correct);
    if (correctOpt) return correctOpt.option_key;
    return null;
}

// Check if bilingual pair has an answer mismatch (compare by option text, fallback to letter)
function hasAnswerMismatch(en, hi) {
    const enLabel = getCorrectLabel(en);
    const hiLabel = getCorrectLabel(hi);
    if (!enLabel || !hiLabel) return false;

    const normalize = (t) => (t || '').replace(/\s+/g, ' ').replace(/\$/g, '').trim().toLowerCase();

    const enCorrectText = (en.options || []).find(o => o.option_key === enLabel)?.opt_text;
    const hiCorrectText = (hi.options || []).find(o => o.option_key === hiLabel)?.opt_text;

    if (enCorrectText && hiCorrectText) {
        const enNorm = normalize(enCorrectText);
        const hiNorm = normalize(hiCorrectText);

        // Same text = same answer, just different position
        if (enNorm === hiNorm) return false;

        // Check if EN correct text exists in any HI option
        const enTextInHi = (hi.options || []).find(o => normalize(o.opt_text) === enNorm);
        if (enTextInHi && enTextInHi.option_key === hiLabel) return false;

        // EN text found in HI but HI picked a different option = true mismatch
        if (enTextInHi) return true;

        // Options are in different languages (EN text vs HI text) - fall back to letter
        return enLabel !== hiLabel;
    }

    return enLabel !== hiLabel;
}

// Helper to flatten display_sections into editable text
function sectionsToText(sections) {
    return toArray(sections).map(s => {
        const prefix = s.key ? `[${s.key}] ` : '';
        // Normalize literal \n sequences to real newlines
        const content = (s.content || '').replace(/\\n/g, '\n');
        return prefix + content;
    }).join('\n\n');
}

// Helper to parse edited text back to display_sections.
// Splits only on [section_key] tags — content between tags (including blank lines) stays together.
function textToSections(text) {
    if (!text || !text.trim()) return [];
    // Split on lines that start with [some_key] — keep the delimiter
    const parts = text.split(/^(?=\[[a-z_]+\]\s)/m).filter(b => b.trim());
    return parts.map(part => {
        const match = part.match(/^\[([a-z_]+)\]\s*([\s\S]*)$/);
        if (match) return { key: match[1], content: match[2].trim() };
        return { key: 'exam_craft', content: part.trim() };
    });
}

// =========================================================
// Editable Solution Panel (one language side)
// =========================================================
function EditableSolutionPanel({ lang, data, label, editState, onEditChange, onTranslateFrom, translating, onCopyFrom }) {
    if (!data) return <div className="text-xs text-gray-400 italic p-3">No {label} version linked</div>;

    const hasSolution = data.solution_status === 'DONE';
    const [showPreview, setShowPreview] = useState(true);

    return (
        <div className="flex-1 min-w-0 flex flex-col">
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

            {/* Question text + options (read-only) */}
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

            {/* Correct answer editor */}
            <div className="px-3 py-1.5 border-b bg-gray-50 flex items-center gap-2">
                <span className="text-xs text-gray-500 font-semibold">Correct:</span>
                {['A', 'B', 'C', 'D'].map(opt => (
                    <button key={opt} onClick={() => onEditChange({ ...editState, correct: opt })}
                        className={`w-6 h-6 text-xs font-bold rounded border ${editState.correct === opt ? 'bg-green-500 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'}`}>
                        {opt}
                    </button>
                ))}
            </div>

            {/* Core Answer Basis */}
            <div className="px-3 py-1.5 border-b bg-blue-50">
                <label className="text-[10px] text-gray-500 uppercase font-semibold block mb-0.5">Core Answer Basis</label>
                <input type="text"
                    value={editState.coreBasis || ''}
                    onChange={e => onEditChange({ ...editState, coreBasis: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-400"
                    placeholder="One-line reason why this is correct..." />
            </div>

            {/* Action buttons: Translate / Copy / Format */}
            <div className="px-3 py-1.5 border-b bg-gray-50 flex items-center gap-2 flex-wrap">
                <button onClick={onTranslateFrom} disabled={translating}
                    className="px-2 py-1 text-xs font-semibold bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">
                    {translating ? 'Translating...' : `Translate from ${lang === 'en' ? 'Hindi' : 'English'}`}
                </button>
                <button onClick={onCopyFrom}
                    className="px-2 py-1 text-xs font-semibold bg-gray-600 text-white rounded hover:bg-gray-700">
                    Copy from {lang === 'en' ? 'Hindi' : 'English'}
                </button>
                <button onClick={() => onEditChange({ ...editState, solutionText: formatSentences(editState.solutionText) })}
                    className="px-2 py-1 text-xs font-semibold bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    title="Add line breaks after sentences (. and ।)">
                    Format
                </button>
                <button onClick={() => setShowPreview(!showPreview)}
                    className="px-2 py-1 text-xs font-semibold bg-white text-gray-600 border border-gray-300 rounded hover:bg-gray-50 ml-auto">
                    {showPreview ? 'Hide Preview' : 'Show Preview'}
                </button>
            </div>

            {/* Editable solution text */}
            <div className="px-3 py-2 flex-1 flex flex-col">
                <textarea
                    value={editState.solutionText}
                    onChange={e => onEditChange({ ...editState, solutionText: e.target.value })}
                    rows={8}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                    placeholder="[exam_craft] Solution text here...&#10;&#10;[toppers_insight] One-liner..."
                />

                {/* Preview */}
                {showPreview && editState.solutionText && (
                    <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200 text-xs space-y-1.5 max-h-64 overflow-y-auto">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Preview</p>
                        {textToSections(editState.solutionText).map((sec, i) => (
                            <div key={i}>
                                <div className="font-bold text-gray-600 uppercase mb-0.5">{(sec.key || '').replace(/_/g, ' ')}</div>
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
        </div>
    );
}

// =========================================================
// Bilingual question pair card (editable)
// =========================================================
function BilingualCard({ pair, idx, onSaveSuccess, onDifficultyChange }) {
    const [expanded, setExpanded] = useState(true);

    // Edit state for EN and HI
    const enSections = toArray(pair.en?.solution_json?.display_sections);
    const hiSections = toArray(pair.hi?.solution_json?.display_sections);

    const [enEdit, setEnEdit] = useState({
        solutionText: sectionsToText(enSections),
        correct: pair.en?.correct || '',
        coreBasis: pair.en?.solution_json?.answer_outcome?.core_answer_basis || '',
    });
    const [hiEdit, setHiEdit] = useState({
        solutionText: sectionsToText(hiSections),
        correct: pair.hi?.correct || '',
        coreBasis: pair.hi?.solution_json?.answer_outcome?.core_answer_basis || '',
    });

    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState(null);
    const [translatingEn, setTranslatingEn] = useState(false);
    const [translatingHi, setTranslatingHi] = useState(false);
    const [figureUrl, setFigureUrl] = useState(
        pair.en?.solution_json?.figure_url || pair.en?.solution_json?.answer_outcome?.figure_url || ''
    );
    const [uploadingFigure, setUploadingFigure] = useState(false);
    const [figureNeeded, setFigureNeeded] = useState(!!(pair.en?.figure_helpful));
    const [dismissingFigure, setDismissingFigure] = useState(false);

    const enDone = pair.en?.solution_status === 'DONE';
    const hiDone = pair.hi?.solution_status === 'DONE';
    const bothDone = enDone && hiDone;
    // Build live data using current correct selections for mismatch check
    const enLive = { correct: enEdit.correct || getCorrectLabel(pair.en), options: pair.en?.options || [] };
    const hiLive = { correct: hiEdit.correct || getCorrectLabel(pair.hi), options: pair.hi?.options || [] };
    const answerMismatch = hasAnswerMismatch(enLive, hiLive);

    // Translate: take the OTHER side's text, translate it, put it in THIS side
    const handleTranslate = async (targetLang) => {
        const sourceText = targetLang === 'en' ? hiEdit.solutionText : enEdit.solutionText;
        if (!sourceText.trim()) return;

        const setTranslating = targetLang === 'en' ? setTranslatingEn : setTranslatingHi;
        const setEdit = targetLang === 'en' ? setEnEdit : setHiEdit;

        setTranslating(true);
        try {
            const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: sourceText,
                    source: targetLang === 'en' ? 'hi' : 'en',
                    target: targetLang === 'en' ? 'en' : 'hi',
                }),
            });
            const data = await res.json();
            if (data.translatedText) {
                setEdit(prev => ({ ...prev, solutionText: data.translatedText }));
            }
        } catch (e) {
            console.error('Translation error:', e);
        } finally {
            setTranslating(false);
        }
    };

    // Copy: take the OTHER side's text verbatim
    const handleCopy = (targetLang) => {
        if (targetLang === 'en') {
            setEnEdit(prev => ({ ...prev, solutionText: hiEdit.solutionText }));
        } else {
            setHiEdit(prev => ({ ...prev, solutionText: enEdit.solutionText }));
        }
    };

    // Save both sides
    const handleSave = async () => {
        setSaving(true);
        setSaveMsg(null);
        try {
            const buildPayload = (data, editState) => {
                if (!data?.question_id) return null;
                const existingSol = data.solution_json || {};
                const solJson = {
                    ...existingSol,
                    display_sections: textToSections(editState.solutionText),
                };
                if (!solJson.answer_outcome) solJson.answer_outcome = {};
                solJson.answer_outcome.core_answer_basis = editState.coreBasis || '';
                if (figureUrl) {
                    solJson.figure_url = figureUrl;
                    solJson.answer_outcome.figure_url = figureUrl;
                }
                return {
                    question_id: data.question_id,
                    version_no: data.version_no || 1,
                    correct_option_label: editState.correct || '',
                    solution_json: solJson,
                };
            };

            const res = await fetch('/api/solution-review/bilingual-save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    link_id: pair.link_id,
                    en: buildPayload(pair.en, enEdit),
                    hi: buildPayload(pair.hi, hiEdit),
                    difficulty: pair.en?.difficulty || null,
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setSaveMsg('Saved!');
                if (onSaveSuccess) onSaveSuccess();
                setTimeout(() => setSaveMsg(null), 3000);
            } else {
                setSaveMsg('Error: ' + (data.error || 'Failed'));
            }
        } catch (e) {
            setSaveMsg('Error: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={`border rounded-lg overflow-hidden ${answerMismatch ? 'border-red-400 ring-1 ring-red-200' : bothDone ? 'border-gray-200' : 'border-amber-300'}`}>
            {/* Pair header */}
            <div className="px-3 py-1.5 bg-gray-50 border-b flex items-center justify-between">
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
                    <span className="text-xs font-bold text-gray-600">#{idx + 1}</span>
                    {pair.section_code && <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{pair.section_code}</span>}
                    {/* Difficulty buttons */}
                    <div className="flex gap-0.5" onClick={e => e.stopPropagation()}>
                        {[{ val: 1, label: 'E', cls: 'bg-green-100 text-green-700 border-green-300', active: 'bg-green-600 text-white border-green-600' },
                          { val: 2, label: 'M', cls: 'bg-yellow-100 text-yellow-700 border-yellow-300', active: 'bg-yellow-500 text-white border-yellow-500' },
                          { val: 3, label: 'H', cls: 'bg-red-100 text-red-700 border-red-300', active: 'bg-red-600 text-white border-red-600' },
                        ].map(d => (
                            <button key={d.val} onClick={() => onDifficultyChange && onDifficultyChange(pair.en?.question_id, pair.en?.version_no, d.val)}
                                className={`w-5 h-5 text-[10px] font-bold rounded border ${pair.en?.difficulty === d.val ? d.active : d.cls} transition-colors`}
                                title={d.val === 1 ? 'Easy' : d.val === 2 ? 'Medium' : 'Hard'}>
                                {d.label}
                            </button>
                        ))}
                    </div>
                    {pair.en?.subtype && <span className="text-xs text-gray-400">{pair.en.subtype}</span>}
                    {answerMismatch && (
                        <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">
                            ANSWER MISMATCH: EN={enEdit.correct} HI={hiEdit.correct}
                        </span>
                    )}
                    {!bothDone && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                            {!enDone && !hiDone ? 'Both unsolved' : !enDone ? 'EN unsolved' : 'HI unsolved'}
                        </span>
                    )}
                    {(pair.en?.figure_prompt || pair.en?.figure_helpful) && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Fig</span>
                    )}
                    <span className="text-xs text-gray-400">{expanded ? '[-]' : '[+]'}</span>
                </div>
                <div className="flex items-center gap-2">
                    {saveMsg && (
                        <span className={`text-xs font-semibold ${saveMsg === 'Saved!' ? 'text-green-600' : 'text-red-600'}`}>
                            {saveMsg}
                        </span>
                    )}
                    <button onClick={handleSave} disabled={saving}
                        className="px-3 py-1 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                        {saving ? 'Saving...' : 'Save Both'}
                    </button>
                </div>
            </div>

            {/* Side by side editable panels */}
            {expanded && (
                <>
                    <div className="flex divide-x divide-gray-200">
                        <EditableSolutionPanel
                            lang="en" data={pair.en} label="English"
                            editState={enEdit} onEditChange={setEnEdit}
                            onTranslateFrom={() => handleTranslate('en')}
                            translating={translatingEn}
                            onCopyFrom={() => handleCopy('en')}
                        />
                        <EditableSolutionPanel
                            lang="hi" data={pair.hi} label="Hindi"
                            editState={hiEdit} onEditChange={setHiEdit}
                            onTranslateFrom={() => handleTranslate('hi')}
                            translating={translatingHi}
                            onCopyFrom={() => handleCopy('hi')}
                        />
                    </div>

                    {/* Figure Prompt + Upload (shared for the pair) */}
                    {(pair.en?.figure_prompt || figureNeeded) && (
                        <div className="px-4 py-3 border-t border-gray-200 bg-amber-50">
                            <div className="flex items-center gap-2 mb-1">
                                <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Figure Prompt</label>
                                <button
                                    disabled={dismissingFigure}
                                    onClick={async () => {
                                        setDismissingFigure(true);
                                        try {
                                            // Update both EN and HI
                                            await Promise.all([
                                                fetch('/api/solution-review/toggle-figure', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ question_id: pair.en.question_id, version_no: pair.en.version_no, language: 'EN', value: false }),
                                                }),
                                                pair.hi?.question_id ? fetch('/api/solution-review/toggle-figure', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ question_id: pair.hi.question_id, version_no: pair.hi.version_no, language: 'HI', value: false }),
                                                }) : Promise.resolve(),
                                            ]);
                                            setFigureNeeded(false);
                                        } catch (e) { console.error(e); }
                                        finally { setDismissingFigure(false); }
                                    }}
                                    className="px-2 py-0.5 text-[10px] font-semibold bg-white text-red-600 border border-red-300 rounded hover:bg-red-50 disabled:opacity-50"
                                >
                                    {dismissingFigure ? '...' : 'Figure Not Needed'}
                                </button>
                            </div>
                            {pair.en?.figure_prompt && <div className="text-xs text-gray-700 mb-2">{pair.en.figure_prompt}</div>}
                            <div className="mt-1">
                                {figureUrl ? (
                                    <div className="relative inline-block">
                                        <img src={figureUrl} alt="Solution figure" className="max-h-40 rounded border border-gray-300 object-contain" />
                                        <button onClick={() => setFigureUrl('')}
                                            className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                                            title="Remove figure">x</button>
                                    </div>
                                ) : (
                                    <div
                                        className="border-2 border-dashed border-amber-300 rounded-lg p-3 text-center cursor-pointer hover:border-amber-500 hover:bg-amber-100 transition-colors"
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
                                                                    question_id: pair.en.question_id,
                                                                    language: 'EN',
                                                                    version_no: pair.en.version_no,
                                                                    role: 'solution_figure',
                                                                }),
                                                            });
                                                            const data = await res.json();
                                                            if (data.url || data.secure_url || data.latexPath) {
                                                                setFigureUrl(data.url || data.secure_url || data.latexPath);
                                                            } else {
                                                                alert('Upload failed: ' + (data.error || 'No URL returned'));
                                                            }
                                                        } catch (err) {
                                                            console.error('Figure upload error:', err);
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
                                        {uploadingFigure
                                            ? <span className="text-xs text-amber-700">Uploading...</span>
                                            : <span className="text-xs text-amber-600">Paste generated figure here (Ctrl+V)</span>
                                        }
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// =========================================================
// Main Component
// =========================================================
export default function SolutionReviewBilingual({ exams }) {
    const [selectedExamId, setSelectedExamId] = useState('');
    const [papers, setPapers] = useState([]);
    const [loadingPapers, setLoadingPapers] = useState(false);
    const [selectedPair, setSelectedPair] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [filter, setFilter] = useState('all');
    const [feedback, setFeedback] = useState(null);
    const [advancing, setAdvancing] = useState(false);

    const handleAdvanceStatus = async (sessionId, nextStatus) => {
        if (!confirm(`Move paper to ${nextStatus}?`)) return;
        setAdvancing(true);
        try {
            const res = await fetch('/api/paper/advance-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paper_session_id: sessionId, next_status: nextStatus }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', msg: `Moved to ${nextStatus}` });
                setTimeout(() => setFeedback(null), 3000);
            } else {
                setFeedback({ type: 'error', msg: data.error || 'Failed' });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setAdvancing(false);
        }
    };

    const handleAdvanceBoth = async (nextStatus) => {
        if (!selectedPair) return;
        if (!confirm(`Move BOTH EN and HI papers to ${nextStatus}?`)) return;
        setAdvancing(true);
        try {
            const [res1, res2] = await Promise.all([
                fetch('/api/paper/advance-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ paper_session_id: selectedPair.en_session_id, next_status: nextStatus }),
                }),
                fetch('/api/paper/advance-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ paper_session_id: selectedPair.hi_session_id, next_status: nextStatus }),
                }),
            ]);
            const d1 = await res1.json();
            const d2 = await res2.json();
            if (d1.success && d2.success) {
                setFeedback({ type: 'success', msg: `Both papers moved to ${nextStatus}` });
            } else {
                setFeedback({ type: 'error', msg: `EN: ${d1.error || 'OK'}, HI: ${d2.error || 'OK'}` });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setAdvancing(false);
            setTimeout(() => setFeedback(null), 4000);
        }
    };

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

    const loadQuestions = async (enId, hiId) => {
        setLoadingQuestions(true);
        setFeedback(null);
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

    const handlePaperChange = async (val) => {
        if (!val) return;
        const [enId, hiId] = val.split('|');
        const pair = papers.find(p => p.en_session_id === enId && p.hi_session_id === hiId);
        setSelectedPair(pair);
        setQuestions([]);
        setFilter('all');
        await loadQuestions(enId, hiId);
    };

    // Handle difficulty change (updates EN side — shared for pair)
    const handleDifficultyChange = async (questionId, versionNo, newDifficulty) => {
        // Optimistic update — both EN and HI
        setQuestions(prev => prev.map(q =>
            q.en?.question_id === questionId
                ? { ...q, en: { ...q.en, difficulty: newDifficulty }, hi: q.hi ? { ...q.hi, difficulty: newDifficulty } : q.hi }
                : q
        ));
        try {
            const pair = questions.find(q => q.en?.question_id === questionId);
            // Save to both EN and HI in parallel
            const saves = [
                fetch('/api/question/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: questionId, version_no: versionNo || 1, language: 'EN',
                        question_text: pair?.en?.text || '', difficulty: newDifficulty,
                    }),
                }),
            ];
            if (pair?.hi?.question_id) {
                saves.push(
                    fetch('/api/question/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: pair.hi.question_id, version_no: pair.hi.version_no || 1, language: 'HI',
                            question_text: pair.hi.text || '', difficulty: newDifficulty,
                        }),
                    })
                );
            }
            await Promise.all(saves);
        } catch (e) { console.error('Difficulty update error:', e); }
    };

    const filteredQuestions = questions.filter(q => {
        const enDone = q.en?.solution_status === 'DONE';
        const hiDone = q.hi?.solution_status === 'DONE';
        if (filter === 'both_solved') return enDone && hiDone;
        if (filter === 'unsolved') return !enDone || !hiDone;
        if (filter === 'mismatch') return hasAnswerMismatch(q.en, q.hi);
        if (filter === 'figures') return !!(q.en?.figure_prompt || q.en?.figure_helpful);
        return true;
    });

    const bothSolvedCount = questions.filter(q => q.en?.solution_status === 'DONE' && q.hi?.solution_status === 'DONE').length;
    const mismatchCount = questions.filter(q => hasAnswerMismatch(q.en, q.hi)).length;
    const figuresCount = questions.filter(q => q.en?.figure_prompt || q.en?.figure_helpful).length;

    // Group by section for sidebar
    const groupedQuestions = questions.reduce((acc, q) => {
        const sec = q.section_code || 'Other';
        if (!acc[sec]) acc[sec] = [];
        acc[sec].push(q);
        return acc;
    }, {});

    // Section-wise difficulty stats (from EN side)
    const sectionStats = Object.entries(groupedQuestions).map(([code, qs]) => ({
        code,
        total: qs.length,
        easy: qs.filter(q => q.en?.difficulty === 1).length,
        medium: qs.filter(q => q.en?.difficulty === 2).length,
        hard: qs.filter(q => q.en?.difficulty === 3).length,
        unset: qs.filter(q => !q.en?.difficulty).length,
    }));

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-white">
            {/* Top Bar — Row 1: Selectors */}
            <div className="flex-shrink-0 bg-white border-b border-gray-200 shadow-sm px-4 py-2 space-y-2">
                <div className="flex items-center gap-3">
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
                            className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm min-w-[300px] disabled:opacity-50"
                        >
                            {(() => {
                                const pendingPapers = papers.filter(p => !['SOLUTION_REVIEW', 'PRODUCTION'].includes(p.en_status));
                                const reviewedPapers = papers.filter(p => ['SOLUTION_REVIEW', 'PRODUCTION'].includes(p.en_status));
                                return (
                                    <>
                                        <option value="">{loadingPapers ? 'Loading...' : `Select Paper Pair (${papers.length})...`}</option>
                                        {pendingPapers.length > 0 && (
                                            <optgroup label={`To Review (${pendingPapers.length})`}>
                                                {pendingPapers.map(p => (
                                                    <option key={`${p.en_session_id}|${p.hi_session_id}`} value={`${p.en_session_id}|${p.hi_session_id}`}>
                                                        {p.en_label} — {p.linked_count} linked, EN {p.en_solved}/{p.en_total} HI {p.hi_solved}/{p.hi_total}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        )}
                                        {reviewedPapers.length > 0 && (
                                            <optgroup label={`Reviewed / Production (${reviewedPapers.length})`}>
                                                {reviewedPapers.map(p => (
                                                    <option key={`${p.en_session_id}|${p.hi_session_id}`} value={`${p.en_session_id}|${p.hi_session_id}`}>
                                                        {p.en_label} — {p.linked_count} linked [{p.en_status}]
                                                    </option>
                                                ))}
                                            </optgroup>
                                        )}
                                    </>
                                );
                            })()}
                        </select>
                    )}

                    {feedback && (
                        <span className={`text-xs px-2.5 py-1 rounded font-medium flex-shrink-0 ${feedback.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                            {feedback.msg}
                        </span>
                    )}
                </div>

                {/* Row 2: Stats + Filters + Actions (only when paper loaded) */}
                {selectedPair && questions.length > 0 && (
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">
                            {bothSolvedCount}/{questions.length} both solved
                            {mismatchCount > 0 && <span className="text-red-600 ml-1">({mismatchCount} mismatches)</span>}
                        </span>
                        {selectedPair?.en_pdf_path && (
                            <a href={`/api/pdf?path=${encodeURIComponent(selectedPair.en_pdf_path)}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-0.5 rounded">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" /><path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" /></svg>
                                EN PDF
                            </a>
                        )}
                        {selectedPair?.hi_pdf_path && (
                            <a href={`/api/pdf?path=${encodeURIComponent(selectedPair.hi_pdf_path)}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs text-orange-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-0.5 rounded">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" /><path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" /></svg>
                                HI PDF
                            </a>
                        )}
                        <a href={`/bilingual/${selectedPair.en_session_id}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs text-purple-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-0.5 rounded">
                            Edit Bilingual
                        </a>
                        <a href={`/test?testId=${selectedPair.en_session_id}&locked=true`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-0.5 rounded">
                            Edit EN
                        </a>
                        <a href={`/test?testId=${selectedPair.hi_session_id}&locked=true`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs text-orange-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-0.5 rounded">
                            Edit HI
                        </a>
                        <div className="flex gap-1">
                            {[
                                { key: 'all', label: 'All' },
                                { key: 'both_solved', label: 'Both Solved' },
                                { key: 'unsolved', label: 'Unsolved' },
                                { key: 'mismatch', label: 'Mismatches' },
                                { key: 'figures', label: `Figures (${figuresCount})` },
                            ].map(f => (
                                <button key={f.key} onClick={() => setFilter(f.key)}
                                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${filter === f.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-1.5 ml-auto">
                            <button onClick={() => handleAdvanceBoth('SOLUTION_REVIEW')} disabled={advancing}
                                className="px-3 py-1 text-xs font-semibold bg-amber-500 text-white rounded-md hover:bg-amber-600 disabled:opacity-50">
                                {advancing ? '...' : 'Mark Solution Reviewed'}
                            </button>
                            <button onClick={() => handleAdvanceBoth('PRODUCTION')} disabled={advancing}
                                className="px-3 py-1 text-xs font-semibold bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50">
                                {advancing ? '...' : 'Move to Production'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Row 3: Section-wise difficulty table */}
                {selectedPair && sectionStats.length > 0 && (
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
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar */}
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
                                                const mismatch = hasAnswerMismatch(q.en, q.hi);
                                                const qLabel = q.en?.q_no ? q.en.q_no.replace(/Q\.\s*/, '').trim() : '?';

                                                let colorClass;
                                                if (mismatch) colorClass = 'text-white bg-red-600 border-red-700';
                                                else if (bothDone) colorClass = 'text-gray-600 bg-green-50 border-green-200 hover:bg-green-100';
                                                else if (enDone || hiDone) colorClass = 'text-amber-700 bg-amber-50 border-amber-300 hover:bg-amber-100';
                                                else colorClass = 'text-red-700 bg-red-50 border-red-300 hover:bg-red-100';

                                                return (
                                                    <a key={q.link_id}
                                                        href={`#bp-${q.link_id}`}
                                                        onClick={e => { e.preventDefault(); document.getElementById(`bp-${q.link_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
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
                                    <BilingualCard pair={q} idx={idx} onDifficultyChange={handleDifficultyChange} />
                                </div>
                            ))}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
