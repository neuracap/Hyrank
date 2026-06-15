'use client';

import { useState, useEffect, useMemo, useCallback, useRef, memo, lazy, Suspense } from 'react';
import Latex from '@/components/Latex';
import { checkQuestionQuality, hasQuestionError } from '@/lib/question-checks';
const FigureEditor = lazy(() => import('@/components/FigureEditor'));

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

// Check if bilingual pair has an answer mismatch
// Compares by option TEXT across languages (handles jumbled option order)
function hasAnswerMismatch(en, hi) {
    const enLabel = getCorrectLabel(en);
    const hiLabel = getCorrectLabel(hi);
    if (!enLabel || !hiLabel) return false;

    const normalize = (t) => (t || '').replace(/\s+/g, ' ').replace(/\$/g, '').trim().toLowerCase();

    const enOpts = en.options || [];
    const hiOpts = hi.options || [];
    const enCorrectText = enOpts.find(o => o.option_key === enLabel)?.opt_text;
    const hiCorrectText = hiOpts.find(o => o.option_key === hiLabel)?.opt_text;

    // If either side has no correct option text, can't compare by text
    if (!enCorrectText || !hiCorrectText) return enLabel !== hiLabel;

    const enNorm = normalize(enCorrectText);
    const hiNorm = normalize(hiCorrectText);

    // 1. Direct text match (same text, maybe different label) = no mismatch
    if (enNorm === hiNorm) return false;

    // 2. Cross-match: find EN correct text among HI options (handles jumbled + same-language options)
    const enTextInHi = hiOpts.find(o => normalize(o.opt_text) === enNorm);
    if (enTextInHi) {
        // EN's correct text exists in HI — mismatch only if HI picked a different one
        return enTextInHi.option_key !== hiLabel;
    }

    // 3. Cross-match the other way: find HI correct text among EN options
    const hiTextInEn = enOpts.find(o => normalize(o.opt_text) === hiNorm);
    if (hiTextInEn) {
        // HI's correct text exists in EN — mismatch only if EN picked a different one
        return hiTextInEn.option_key !== enLabel;
    }

    // 4. Texts are in different scripts (EN vs Hindi) — compare numerics/formulas stripped of script
    //    Extract just numbers/math from both to see if they match
    const extractNumeric = (t) => t.replace(/[^\d.+\-*/=<>%()^,]/g, '').trim();
    const enNum = extractNumeric(enNorm);
    const hiNum = extractNumeric(hiNorm);
    if (enNum && hiNum && enNum.length >= 1) {
        if (enNum === hiNum) return false;
        // Check if EN numeric matches any HI option's numeric
        const enNumInHi = hiOpts.find(o => extractNumeric(normalize(o.opt_text)) === enNum);
        if (enNumInHi) return enNumInHi.option_key !== hiLabel;
    }

    // 5. Can't determine by text — NOT a mismatch (avoid false positives from translations)
    return false;
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
    if (!data) {
        return (
            <div className="flex-1 min-w-0 flex flex-col bg-gray-50/60">
                <div className={`px-3 py-1.5 text-xs font-bold border-b ${lang === 'en' ? 'bg-blue-50/40 text-blue-400' : 'bg-orange-50/40 text-orange-400'}`}>
                    {label} — (no counterpart)
                </div>
                <div className="flex-1 flex items-center justify-center text-xs text-gray-400 italic p-6">
                    Standalone — no linked {label} version
                </div>
            </div>
        );
    }

    const hasSolution = data.solution_status === 'DONE';
    const [showPreview, setShowPreview] = useState(true);
    const [editingQuestion, setEditingQuestion] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [uploadErr, setUploadErr] = useState(null);

    const optionKeys = ['A', 'B', 'C', 'D'];
    const existingOptByKey = Object.fromEntries(
        (data.options || []).map(o => [o.option_key, o])
    );
    const draftOptionFor = (k) => {
        if (editState.options && Object.prototype.hasOwnProperty.call(editState.options, k)) {
            return editState.options[k];
        }
        return existingOptByKey[k]?.opt_text || '';
    };
    const setDraftOption = (k, value) => {
        const next = { ...(editState.options || {}) };
        next[k] = value;
        onEditChange({ ...editState, options: next });
    };

    // Paste-to-upload for the stem textarea and option inputs. Mirrors the
    // Add Missing Question modal: uploads the pasted image to /api/upload and
    // inserts the canonical `![](url)` markdown at the cursor. We pass the
    // question's identifiers so the upload lands under assets/{exam}/{session}/
    // and gets recorded in question_asset_map.
    const handleImagePaste = async (e, currentValue, setNewValue, optionKey) => {
        const items = Array.from(e.clipboardData?.items || []);
        const imgItem = items.find(it => it.type && it.type.startsWith('image/'));
        if (!imgItem) return;
        e.preventDefault();
        const el = e.target;
        const start = (typeof el.selectionStart === 'number') ? el.selectionStart : currentValue.length;
        const end   = (typeof el.selectionEnd   === 'number') ? el.selectionEnd   : currentValue.length;
        const file = imgItem.getAsFile();
        if (!file) return;
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
                question_id: data.question_id,
                version_no: data.version_no || 1,
                language: lang === 'en' ? 'EN' : 'HI',
                role: optionKey ? 'option' : 'stem',
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
                    <button
                        type="button"
                        onClick={() => setEditingQuestion(v => !v)}
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${editingQuestion ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50'}`}
                        title="Edit question stem and options"
                    >
                        {editingQuestion ? 'Done' : 'Edit Q'}
                    </button>
                </div>
            </div>

            {/* Question text + options (read or edit) */}
            <div className="px-3 py-2 border-b bg-white">
                {!editingQuestion ? (
                    <>
                        <div className="text-sm text-gray-800">
                            <Latex>{editState.bodyText ?? data.text ?? '(No text)'}</Latex>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 mt-2">
                            {optionKeys.map(k => {
                                const text = draftOptionFor(k);
                                const isBlank = !text || !text.trim();
                                return (
                                    <div key={k} className={`text-xs p-1.5 rounded border ${isBlank ? 'bg-red-50 border-red-300' : k === editState.correct ? 'bg-green-50 border-green-300 font-semibold' : 'bg-white border-gray-200'}`}>
                                        <span className="font-bold mr-1">{k})</span>
                                        {isBlank ? <span className="text-red-500 italic">BLANK</span> : <Latex>{text}</Latex>}
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
                                value={editState.bodyText ?? data.text ?? ''}
                                onChange={e => onEditChange({ ...editState, bodyText: e.target.value })}
                                onPaste={e => handleImagePaste(
                                    e,
                                    editState.bodyText ?? data.text ?? '',
                                    (next) => onEditChange({ ...editState, bodyText: next }),
                                )}
                                rows={Math.max(2, Math.min(10, Math.ceil(((editState.bodyText ?? data.text ?? '').length || 0) / 80)))}
                                className="w-full border border-blue-300 rounded px-2 py-1 text-sm font-mono focus:ring-2 focus:ring-blue-400"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                            {optionKeys.map(k => (
                                <label key={k} className="block">
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">Option {k}</span>
                                    <input
                                        type="text"
                                        value={draftOptionFor(k)}
                                        onChange={e => setDraftOption(k, e.target.value)}
                                        onPaste={e => handleImagePaste(
                                            e,
                                            draftOptionFor(k),
                                            (next) => setDraftOption(k, next),
                                            k,
                                        )}
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
                const issues = checkQuestionQuality(data.text, data.options, data.correct);
                if (issues.length === 0) return null;
                return (
                    <div className="px-3 py-1.5 border-b bg-pink-50 text-xs">
                        {issues.map((w, i) => (
                            <div key={i} className={`flex items-center gap-1.5 ${w.severity === 'error' ? 'text-red-700 font-semibold' : 'text-orange-700'}`}>
                                <span>{w.severity === 'error' ? '\u26D4' : '\u26A0\uFE0F'}</span> {w.message}
                            </div>
                        ))}
                    </div>
                );
            })()}

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
// Visibility-gated mount: tracks whether a card has scrolled into (or near)
// the viewport. Cards default to "not seen yet" so the heavy editable panels
// don't render until the user actually scrolls to them. Once seen, the gate
// stays true (we don't unmount when scrolling away — keeping it mounted
// preserves in-flight edits, save state, focus, etc.).
// =========================================================
function useHasBeenVisible(ref, rootMargin = '600px') {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (visible) return;
        const el = ref.current;
        if (!el) return;
        if (typeof IntersectionObserver === 'undefined') {
            setVisible(true);
            return;
        }
        const obs = new IntersectionObserver((entries) => {
            for (const e of entries) {
                if (e.isIntersecting) {
                    setVisible(true);
                    obs.disconnect();
                    break;
                }
            }
        }, { rootMargin });
        obs.observe(el);
        return () => obs.disconnect();
    }, [ref, visible, rootMargin]);
    return visible;
}

// =========================================================
// Bilingual question pair card (editable)
// =========================================================
const BilingualCard = memo(function BilingualCard({ pair, idx, onSaveSuccess, onDifficultyChange }) {
    const [expanded, setExpanded] = useState(true);
    const rootRef = useRef(null);
    const hasBeenVisible = useHasBeenVisible(rootRef);

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
    const [mockWorthiness, setMockWorthiness] = useState(pair.en?.mock_worthiness || null);
    const [saveMsg, setSaveMsg] = useState(null);
    const [translatingEn, setTranslatingEn] = useState(false);
    const [translatingHi, setTranslatingHi] = useState(false);
    const [figureUrl, setFigureUrl] = useState(
        pair.en?.solution_json?.answer_outcome?.figure_url || ''
    );
    const [uploadingFigure, setUploadingFigure] = useState(false);
    const [figureNeeded, setFigureNeeded] = useState(!!(pair.en?.figure_helpful || pair.en?.figure_prompt));
    const [dismissingFigure, setDismissingFigure] = useState(false);
    const [editingFigure, setEditingFigure] = useState(false);

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
                    solJson.answer_outcome.figure_url = figureUrl;
                }
                const payload = {
                    question_id: data.question_id,
                    version_no: data.version_no || 1,
                    correct_option_label: editState.correct || '',
                    solution_json: solJson,
                };
                // Include question-body edits when they actually changed.
                if (typeof editState.bodyText === 'string' && editState.bodyText !== (data.text || '')) {
                    payload.body_text = editState.bodyText;
                }
                if (editState.options && Object.keys(editState.options).length > 0) {
                    const existingByKey = Object.fromEntries((data.options || []).map(o => [o.option_key, o.opt_text || '']));
                    const optsArr = [];
                    for (const k of Object.keys(editState.options)) {
                        const next = editState.options[k];
                        if (next !== (existingByKey[k] || '')) {
                            optsArr.push({ option_key: k, opt_text: next });
                        }
                    }
                    if (optsArr.length > 0) payload.options = optsArr;
                }
                return payload;
            };

            const res = await fetch('/api/solution-review/bilingual-save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    link_id: pair.link_id,
                    en: buildPayload(pair.en, enEdit),
                    hi: buildPayload(pair.hi, hiEdit),
                    difficulty: pair.en?.difficulty || null,
                    mock_worthiness: mockWorthiness,
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
        <div ref={rootRef} className={`border rounded-lg overflow-hidden ${answerMismatch ? 'border-red-400 ring-1 ring-red-200' : bothDone ? 'border-gray-200' : 'border-amber-300'}`}>
            {/* Pair header */}
            <div className="px-3 py-1.5 bg-gray-50 border-b flex items-center justify-between">
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
                    <span className="text-xs font-bold text-gray-600">#{idx + 1}</span>
                    {pair.section_code && <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{pair.section_code}</span>}
                    {/* Difficulty buttons — fall back to HI side when pair has no EN counterpart */}
                    {(() => {
                        const primary = pair.en || pair.hi;
                        const primaryLang = pair.en ? 'EN' : 'HI';
                        return (
                            <div className="flex gap-0.5" onClick={e => e.stopPropagation()}>
                                {[{ val: 1, label: 'E', cls: 'bg-green-100 text-green-700 border-green-300', active: 'bg-green-600 text-white border-green-600' },
                                  { val: 2, label: 'M', cls: 'bg-yellow-100 text-yellow-700 border-yellow-300', active: 'bg-yellow-500 text-white border-yellow-500' },
                                  { val: 3, label: 'H', cls: 'bg-red-100 text-red-700 border-red-300', active: 'bg-red-600 text-white border-red-600' },
                                ].map(d => (
                                    <button key={d.val}
                                        onClick={() => primary?.question_id && onDifficultyChange && onDifficultyChange(primary.question_id, primary.version_no, d.val, primaryLang)}
                                        disabled={!primary?.question_id}
                                        className={`w-5 h-5 text-[10px] font-bold rounded border ${primary?.difficulty === d.val ? d.active : d.cls} transition-colors disabled:opacity-40`}
                                        title={d.val === 1 ? 'Easy' : d.val === 2 ? 'Medium' : 'Hard'}>
                                        {d.label}
                                    </button>
                                ))}
                            </div>
                        );
                    })()}
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
                    <div className="flex gap-0.5 border border-gray-300 rounded overflow-hidden">
                        {[{ val: 'ANCHOR', label: 'A', color: 'bg-green-600 text-white', title: 'Anchor' },
                          { val: 'ADAPTABLE', label: 'Ad', color: 'bg-blue-500 text-white', title: 'Adaptable' },
                          { val: 'REJECT', label: 'R', color: 'bg-red-500 text-white', title: 'Reject' },
                        ].map(w => (
                            <button key={w.val} onClick={() => setMockWorthiness(mockWorthiness === w.val ? null : w.val)}
                                className={`px-1.5 py-1 text-[10px] font-bold transition-colors ${mockWorthiness === w.val ? w.color : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                title={w.title}>
                                {w.label}
                            </button>
                        ))}
                    </div>
                    <button onClick={handleSave} disabled={saving}
                        className="px-3 py-1 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                        {saving ? 'Saving...' : 'Save Both'}
                    </button>
                </div>
            </div>

            {/* Side by side editable panels — only mounted once the card has
                scrolled within ~600px of the viewport. Shows a lightweight
                placeholder until then so initial paint stays cheap on
                100-question papers. */}
            {expanded && !hasBeenVisible && (
                <div className="px-4 py-8 text-center text-xs text-gray-400 italic border-t border-gray-100">
                    Scrolling reveals the editor…
                </div>
            )}
            {expanded && hasBeenVisible && (
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
                    {figureNeeded && (
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
                                    <div className="flex items-start gap-2">
                                        <div className="relative inline-block">
                                            <img src={figureUrl} alt="Solution figure" className="max-h-40 rounded border border-gray-300 object-contain" />
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
                                                            const url = data.url || data.secure_url || data.latexPath;
                                                            if (url) {
                                                                setFigureUrl(url);
                                                                // Auto-save figure URL to both EN and HI solution_json
                                                                const saveFigure = (qData, lang) => {
                                                                    if (!qData?.question_id) return null;
                                                                    const sj = { ...(qData.solution_json || {}) };
                                                                    if (!sj.answer_outcome) sj.answer_outcome = {};
                                                                    sj.answer_outcome.figure_url = url;
                                                                    return { question_id: qData.question_id, version_no: qData.version_no || 1, solution_json: sj };
                                                                };
                                                                fetch('/api/solution-review/bilingual-save', {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({
                                                                        link_id: pair.link_id,
                                                                        en: saveFigure(pair.en, 'EN'),
                                                                        hi: saveFigure(pair.hi, 'HI'),
                                                                    }),
                                                                }).catch(e => console.error('Auto-save figure error:', e));
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

                    {/* Figure Editor Modal */}
                    {editingFigure && figureUrl && (
                        <Suspense fallback={<div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"><span className="text-white">Loading editor...</span></div>}>
                            <FigureEditor
                                imageUrl={figureUrl}
                                onSave={async (blob) => {
                                    // Upload edited image to Cloudinary
                                    const reader = new FileReader();
                                    reader.readAsDataURL(blob);
                                    await new Promise(resolve => { reader.onloadend = resolve; });
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
                                    const url = data.url || data.secure_url || data.latexPath;
                                    if (url) {
                                        setFigureUrl(url);
                                        // Auto-save to DB
                                        const saveFigure = (qData) => {
                                            if (!qData?.question_id) return null;
                                            const sj = { ...(qData.solution_json || {}) };
                                            if (!sj.answer_outcome) sj.answer_outcome = {};
                                            sj.answer_outcome.figure_url = url;
                                            return { question_id: qData.question_id, version_no: qData.version_no || 1, solution_json: sj };
                                        };
                                        fetch('/api/solution-review/bilingual-save', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ link_id: pair.link_id, en: saveFigure(pair.en), hi: saveFigure(pair.hi) }),
                                        }).catch(e => console.error('Auto-save edited figure error:', e));
                                    }
                                    setEditingFigure(false);
                                }}
                                onClose={() => setEditingFigure(false)}
                            />
                        </Suspense>
                    )}
                </>
            )}
        </div>
    );
});

// =========================================================
// Inline picker row above a standalone card — choose a counterpart
// in the other language and link the two.
// =========================================================
function StandaloneLinkPicker({ side, row, candidates, onLink, busy }) {
    const [selected, setSelected] = useState('');
    const candByKey = Object.fromEntries(candidates.map(c => [c.question_id, c]));
    const trimmed = (t) => (t || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const langLabel = side === 'en' ? 'Hindi' : 'English';

    if (candidates.length === 0) {
        return (
            <div className="text-[11px] text-gray-400 italic px-1 pb-1">
                No standalone {langLabel} questions available to link with.
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 flex-wrap px-1 pb-1">
            <span className="text-[11px] font-semibold text-gray-500">Link to {langLabel}:</span>
            <select
                value={selected}
                onChange={e => setSelected(e.target.value)}
                className="text-xs border border-gray-300 rounded px-2 py-0.5 max-w-md"
            >
                <option value="">Select a candidate…</option>
                {candidates.map(c => (
                    <option key={c.question_id} value={c.question_id}>
                        {c.q_no || 'Q.?'} — {trimmed(c.text) || '(no text)'}
                    </option>
                ))}
            </select>
            <button
                type="button"
                disabled={!selected || busy}
                onClick={() => {
                    const other = candByKey[selected];
                    if (!other) return;
                    if (!confirm(`Link "${row.q_no || 'Q.?'}" with "${other.q_no || 'Q.?'}"?`)) return;
                    const pair = side === 'en'
                        ? { english_question_id: row.question_id, english_version_no: row.version_no, hindi_question_id: other.question_id, hindi_version_no: other.version_no }
                        : { english_question_id: other.question_id, english_version_no: other.version_no, hindi_question_id: row.question_id, hindi_version_no: row.version_no };
                    onLink(pair);
                    setSelected('');
                }}
                className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
            >
                Link
            </button>
        </div>
    );
}

// =========================================================
// Add-missing-question modal
// =========================================================
function AddMissingQuestionModal({ open, onClose, selectedPair, sections, existingQNos, onCreated }) {
    const [mode, setMode] = useState('both'); // 'both' | 'english_only' | 'hindi_only'
    const [qNo, setQNo] = useState('');
    const [sectionName, setSectionName] = useState('');
    const [enText, setEnText] = useState('');
    const [hiText, setHiText] = useState('');
    const [enOpts, setEnOpts] = useState({ A: '', B: '', C: '', D: '' });
    const [hiOpts, setHiOpts] = useState({ A: '', B: '', C: '', D: '' });
    const [correct, setCorrect] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);
    const [uploadingImage, setUploadingImage] = useState(false);

    if (!open) return null;

    // Image paste handler shared by stem textareas and option inputs.
    // Uploads to /api/upload (no question_id — lands in assets/manual-entry)
    // and inserts the canonical `![](url)` markdown at the cursor position.
    const handleImagePaste = async (e, currentValue, setNewValue) => {
        const items = Array.from(e.clipboardData?.items || []);
        const imgItem = items.find(it => it.type && it.type.startsWith('image/'));
        if (!imgItem) return;
        e.preventDefault();
        const el = e.target;
        const start = (typeof el.selectionStart === 'number') ? el.selectionStart : currentValue.length;
        const end   = (typeof el.selectionEnd   === 'number') ? el.selectionEnd   : currentValue.length;
        const file = imgItem.getAsFile();
        if (!file) return;
        setUploadingImage(true);
        setErr(null);
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Could not read image'));
                reader.readAsDataURL(file);
            });
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: dataUrl }),
            });
            const data = await res.json();
            const url = data.latexPath || data.secure_url || data.url;
            if (!res.ok || !url) throw new Error(data.error || 'Upload failed');
            const markdown = `![](${url})`;
            setNewValue(currentValue.slice(0, start) + markdown + currentValue.slice(end));
        } catch (e) {
            setErr('Image upload failed: ' + e.message);
        } finally {
            setUploadingImage(false);
        }
    };

    const reset = () => {
        setMode('both');
        setQNo(''); setSectionName(''); setEnText(''); setHiText('');
        setEnOpts({ A: '', B: '', C: '', D: '' });
        setHiOpts({ A: '', B: '', C: '', D: '' });
        setCorrect(''); setDifficulty('');
        setErr(null); setSuccessMsg(null);
    };

    const close = () => { reset(); onClose(); };

    const submit = async () => {
        setErr(null); setSuccessMsg(null);
        if (!qNo.trim()) { setErr('Question number is required'); return; }
        if (mode === 'english_only' && !enText.trim()) { setErr('Enter the English stem'); return; }
        if (mode === 'hindi_only'   && !hiText.trim()) { setErr('Enter the Hindi stem'); return; }
        if (mode === 'both' && !enText.trim() && !hiText.trim()) { setErr('Enter at least an English or Hindi stem'); return; }
        setSubmitting(true);
        try {
            const payload = {
                mode,
                eng_session_id: selectedPair.en_session_id,
                hin_session_id: selectedPair.hi_session_id,
                section_name: sectionName || null,
                source_question_no: qNo.trim(),
                correct_option_label: correct || null,
                difficulty: difficulty === '' ? null : Number(difficulty),
            };
            if (mode === 'both' || mode === 'english_only') {
                payload.english = { text: enText, options: enOpts };
            }
            if (mode === 'both' || mode === 'hindi_only') {
                payload.hindi = { text: hiText, options: hiOpts };
            }

            const res = await fetch('/api/question/create-bilingual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Create failed');

            if (mode !== 'both' && !data.linkedTo) {
                setSuccessMsg('Created. No matching counterpart in the other language to auto-link — added as standalone.');
            }
            reset();
            onClose();
            if (onCreated) onCreated();
        } catch (e) {
            setErr(e.message);
        } finally {
            setSubmitting(false);
        }
    };

    // Detect numeric gaps in 1..maxKnown to hint missing slots
    const numericQNos = (existingQNos || [])
        .map(x => parseInt(String(x).replace(/[^0-9]/g, ''), 10))
        .filter(Number.isInteger)
        .sort((a, b) => a - b);
    const maxKnown = numericQNos.length > 0 ? numericQNos[numericQNos.length - 1] : 0;
    const presentSet = new Set(numericQNos);
    const gaps = [];
    for (let i = 1; i <= maxKnown; i++) if (!presentSet.has(i)) gaps.push(i);

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={close}>
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
                    <h3 className="text-base font-bold text-gray-900">Add Missing Question</h3>
                    <button onClick={close} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
                </div>
                <div className="px-5 py-4 space-y-4">
                    {/* Mode toggle: insert both, EN only, or HI only */}
                    <div>
                        <span className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Add</span>
                        <div className="inline-flex border border-gray-300 rounded overflow-hidden text-xs font-semibold">
                            {[
                                { val: 'both',         label: 'Both languages' },
                                { val: 'english_only', label: 'English only' },
                                { val: 'hindi_only',   label: 'Hindi only' },
                            ].map(m => (
                                <button key={m.val} type="button"
                                    onClick={() => setMode(m.val)}
                                    className={`px-3 py-1.5 border-r last:border-r-0 border-gray-300 transition-colors ${
                                        mode === m.val ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                                    }`}>
                                    {m.label}
                                </button>
                            ))}
                        </div>
                        {mode !== 'both' && (
                            <p className="text-[11px] text-gray-500 mt-1">
                                If a question with the same number exists on the other side without a link, we&apos;ll
                                auto-link them. Otherwise it&apos;s saved as standalone.
                            </p>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <label className="block">
                            <span className="text-[10px] font-bold text-gray-500 uppercase">Question No.</span>
                            <input
                                type="text"
                                value={qNo}
                                onChange={e => setQNo(e.target.value)}
                                placeholder="e.g. 12  or  Q.12"
                                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mt-0.5"
                            />
                            {gaps.length > 0 && (
                                <span className="block text-[10px] text-gray-500 mt-1">
                                    Gaps detected: {gaps.slice(0, 12).join(', ')}{gaps.length > 12 ? '…' : ''}
                                </span>
                            )}
                            {maxKnown > 0 && gaps.length === 0 && (
                                <span className="block text-[10px] text-gray-500 mt-1">No gaps below {maxKnown}; next would be Q.{maxKnown + 1}</span>
                            )}
                        </label>
                        <label className="block md:col-span-2">
                            <span className="text-[10px] font-bold text-gray-500 uppercase">Section</span>
                            <select
                                value={sectionName}
                                onChange={e => setSectionName(e.target.value)}
                                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mt-0.5"
                            >
                                <option value="">(optional — pick a section)</option>
                                {sections.map(s => (
                                    <option key={s.section_id} value={s.code || s.name}>
                                        {s.code} — {s.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className={`grid grid-cols-1 ${mode === 'both' ? 'md:grid-cols-2' : ''} gap-4`}>
                        {(mode === 'both' || mode === 'english_only') && (
                            <div className="border border-blue-200 rounded p-3 bg-blue-50/30">
                                <div className="text-xs font-bold text-blue-800 mb-2 flex items-center justify-between">
                                    <span>English</span>
                                    <span className="text-[10px] font-normal text-gray-500">paste image (Ctrl+V) supported</span>
                                </div>
                                <textarea
                                    value={enText}
                                    onChange={e => setEnText(e.target.value)}
                                    onPaste={e => handleImagePaste(e, enText, setEnText)}
                                    rows={4}
                                    placeholder="Question stem… (paste image with Ctrl+V)"
                                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono"
                                />
                                <div className="grid grid-cols-2 gap-2 mt-2">
                                    {['A', 'B', 'C', 'D'].map(k => (
                                        <label key={k} className="block">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase">Option {k}</span>
                                            <input
                                                type="text"
                                                value={enOpts[k]}
                                                onChange={e => setEnOpts(o => ({ ...o, [k]: e.target.value }))}
                                                onPaste={e => handleImagePaste(e, enOpts[k], (next) =>
                                                    setEnOpts(o => ({ ...o, [k]: next }))
                                                )}
                                                className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono"
                                            />
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                        {(mode === 'both' || mode === 'hindi_only') && (
                            <div className="border border-orange-200 rounded p-3 bg-orange-50/30">
                                <div className="text-xs font-bold text-orange-800 mb-2 flex items-center justify-between">
                                    <span>Hindi</span>
                                    <span className="text-[10px] font-normal text-gray-500">paste image (Ctrl+V) supported</span>
                                </div>
                                <textarea
                                    value={hiText}
                                    onChange={e => setHiText(e.target.value)}
                                    onPaste={e => handleImagePaste(e, hiText, setHiText)}
                                    rows={4}
                                    placeholder="प्रश्न… (paste image with Ctrl+V)"
                                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono"
                                />
                                <div className="grid grid-cols-2 gap-2 mt-2">
                                    {['A', 'B', 'C', 'D'].map(k => (
                                        <label key={k} className="block">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase">विकल्प {k}</span>
                                            <input
                                                type="text"
                                                value={hiOpts[k]}
                                                onChange={e => setHiOpts(o => ({ ...o, [k]: e.target.value }))}
                                                onPaste={e => handleImagePaste(e, hiOpts[k], (next) =>
                                                    setHiOpts(o => ({ ...o, [k]: next }))
                                                )}
                                                className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono"
                                            />
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-200">
                        <div>
                            <span className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Correct Answer</span>
                            <div className="flex gap-1.5">
                                {['A', 'B', 'C', 'D'].map(k => (
                                    <button
                                        key={k}
                                        type="button"
                                        onClick={() => setCorrect(correct === k ? '' : k)}
                                        className={`w-9 h-9 text-sm font-bold rounded border transition-colors ${
                                            correct === k
                                                ? 'bg-green-600 text-white border-green-700'
                                                : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                                        }`}
                                    >
                                        {k}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <span className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Difficulty</span>
                            <div className="flex gap-1.5">
                                {[
                                    { val: 1, label: 'Easy',   activeCls: 'bg-green-600 text-white border-green-700',   idleCls: 'bg-white text-green-700 border-green-300 hover:bg-green-50' },
                                    { val: 2, label: 'Medium', activeCls: 'bg-yellow-500 text-white border-yellow-600', idleCls: 'bg-white text-yellow-700 border-yellow-300 hover:bg-yellow-50' },
                                    { val: 3, label: 'Hard',   activeCls: 'bg-red-600 text-white border-red-700',       idleCls: 'bg-white text-red-700 border-red-300 hover:bg-red-50' },
                                ].map(d => {
                                    const active = String(difficulty) === String(d.val);
                                    return (
                                        <button
                                            key={d.val}
                                            type="button"
                                            onClick={() => setDifficulty(active ? '' : d.val)}
                                            className={`px-3 h-9 text-xs font-bold rounded border transition-colors ${active ? d.activeCls : d.idleCls}`}
                                        >
                                            {d.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <p className="text-[11px] text-gray-500">
                        A new linked EN+HI pair will be inserted into this paper.
                    </p>

                    {uploadingImage && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                            Uploading image…
                        </div>
                    )}
                    {err && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
                </div>
                <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white">
                    <button onClick={close} disabled={submitting}
                        className="px-3 py-1.5 text-xs font-semibold border border-gray-300 text-gray-700 bg-white rounded hover:bg-gray-50 disabled:opacity-50">
                        Cancel
                    </button>
                    <button onClick={submit} disabled={submitting}
                        className="px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
                        {submitting ? 'Creating…' : 'Create Question'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// =========================================================
// Main Component
// =========================================================
export default function NewSolutionReviewBilingual({ exams }) {
    const [selectedExamId, setSelectedExamId] = useState('');
    const [papers, setPapers] = useState([]);
    const [loadingPapers, setLoadingPapers] = useState(false);
    const [selectedPair, setSelectedPair] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [filter, setFilter] = useState('all');
    const [feedback, setFeedback] = useState(null);
    const [advancing, setAdvancing] = useState(false);
    const [statsCollapsed, setStatsCollapsed] = useState(false);
    const [enUnlinked, setEnUnlinked] = useState([]);
    const [hiUnlinked, setHiUnlinked] = useState([]);
    const [loadingUnlinked, setLoadingUnlinked] = useState(false);
    const [sections, setSections] = useState([]);
    const [addOpen, setAddOpen] = useState(false);
    const [linking, setLinking] = useState(false);
    const [sidebarLang, setSidebarLang] = useState('EN'); // 'EN' | 'HI'

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
        setSections([]);
        if (!examId) return;

        setLoadingPapers(true);
        try {
            const [papersRes, sectionsRes] = await Promise.all([
                fetch(`/api/solution-review/bilingual-papers?exam_id=${examId}`),
                fetch(`/api/exam/sections?exam_id=${examId}`),
            ]);
            const papersData = await papersRes.json();
            const sectionsData = await sectionsRes.json();
            setPapers(papersRes.ok ? (papersData.papers || []) : []);
            setSections(sectionsRes.ok ? (sectionsData.sections || []) : []);
        } catch { setPapers([]); setSections([]); }
        finally { setLoadingPapers(false); }
    };

    const loadQuestions = async (enId, hiId) => {
        setLoadingQuestions(true);
        setLoadingUnlinked(true);
        setFeedback(null);
        setEnUnlinked([]);
        setHiUnlinked([]);
        try {
            const [pairsRes, unlinkedRes] = await Promise.all([
                fetch(`/api/solution-review/bilingual-questions?en_session_id=${enId}&hi_session_id=${hiId}`),
                fetch(`/api/solution-review/bilingual-unlinked?en_session_id=${enId}&hi_session_id=${hiId}`),
            ]);
            const pairsData = await pairsRes.json();
            const unlinkedData = await unlinkedRes.json();
            if (pairsRes.ok) {
                setQuestions(pairsData.questions || []);
            } else {
                setFeedback({ type: 'error', msg: pairsData.error });
            }
            if (unlinkedRes.ok) {
                setEnUnlinked(unlinkedData.en_unlinked || []);
                setHiUnlinked(unlinkedData.hi_unlinked || []);
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setLoadingQuestions(false);
            setLoadingUnlinked(false);
        }
    };

    // Link one or more EN/HI standalone rows into pairs in a single transaction.
    const linkPairs = useCallback(async (pairs) => {
        if (!selectedPair || !pairs || pairs.length === 0) return;
        setLinking(true);
        try {
            const res = await fetch('/api/solution-review/link-unlinked', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    en_session_id: selectedPair.en_session_id,
                    hi_session_id: selectedPair.hi_session_id,
                    pairs,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Link failed');
            setFeedback({ type: 'success', msg: `Linked ${data.linked}${data.skipped ? ` (skipped ${data.skipped})` : ''}` });
            setTimeout(() => setFeedback(null), 3000);
            await loadQuestions(selectedPair.en_session_id, selectedPair.hi_session_id);
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setLinking(false);
        }
    }, [selectedPair]);

    const handlePaperChange = async (val) => {
        if (!val) return;
        const [enId, hiId] = val.split('|');
        const pair = papers.find(p => p.en_session_id === enId && p.hi_session_id === hiId);
        setSelectedPair(pair);
        setQuestions([]);
        setFilter('all');
        await loadQuestions(enId, hiId);
    };

    // Handle difficulty change. For linked pairs the change syncs to both EN and HI.
    // For standalone (unlinked) rows we only update the side that exists.
    // useCallback so the reference stays stable across renders — every BilingualCard
    // receives this handler, and a fresh function reference would force them all to
    // re-render whenever any unrelated state changes.
    const handleDifficultyChange = useCallback(async (questionId, versionNo, newDifficulty, primaryLang = 'EN') => {
        // Optimistic update across all three lists.
        setQuestions(prev => prev.map(q =>
            q.en?.question_id === questionId
                ? { ...q, en: { ...q.en, difficulty: newDifficulty }, hi: q.hi ? { ...q.hi, difficulty: newDifficulty } : q.hi }
                : q.hi?.question_id === questionId
                    ? { ...q, hi: { ...q.hi, difficulty: newDifficulty }, en: q.en ? { ...q.en, difficulty: newDifficulty } : q.en }
                    : q
        ));
        setEnUnlinked(prev => prev.map(r => r.question_id === questionId ? { ...r, difficulty: newDifficulty } : r));
        setHiUnlinked(prev => prev.map(r => r.question_id === questionId ? { ...r, difficulty: newDifficulty } : r));

        try {
            // Locate the row in any list to recover the counterpart (if any).
            const linkedPair = questions.find(q => q.en?.question_id === questionId || q.hi?.question_id === questionId);
            const saves = [];
            const pushSave = (qid, vno, lang, text) => {
                if (!qid) return;
                saves.push(fetch('/api/question/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: qid, version_no: vno || 1, language: lang, question_text: text || '', difficulty: newDifficulty }),
                }));
            };

            if (linkedPair) {
                pushSave(linkedPair.en?.question_id, linkedPair.en?.version_no, 'EN', linkedPair.en?.text);
                pushSave(linkedPair.hi?.question_id, linkedPair.hi?.version_no, 'HI', linkedPair.hi?.text);
            } else {
                // Standalone row — only update the language that exists.
                const fromEn = enUnlinked.find(r => r.question_id === questionId);
                const fromHi = hiUnlinked.find(r => r.question_id === questionId);
                if (fromEn) pushSave(fromEn.question_id, fromEn.version_no, 'EN', fromEn.text);
                if (fromHi) pushSave(fromHi.question_id, fromHi.version_no, 'HI', fromHi.text);
                if (!fromEn && !fromHi) {
                    pushSave(questionId, versionNo, primaryLang, '');
                }
            }
            await Promise.all(saves);
        } catch (e) { console.error('Difficulty update error:', e); }
    }, [questions, enUnlinked, hiUnlinked]);

    // Per-row issue cache so quality checks don't run again for every filter/sort/sidebar pass.
    // Map key is the question_id+language; value is the boolean issue flag for the EN/HI side.
    const issueCache = useMemo(() => {
        const cache = new Map();
        const check = (side) => {
            if (!side?.question_id) return false;
            const key = `${side.question_id}|${side.language || ''}`;
            if (cache.has(key)) return cache.get(key);
            const flag = hasQuestionError(side.text, side.options, side.correct);
            cache.set(key, flag);
            return flag;
        };
        for (const q of questions) { check(q.en); check(q.hi); }
        for (const r of enUnlinked) cache.set(`${r.question_id}|EN`, hasQuestionError(r.text, r.options, r.correct));
        for (const r of hiUnlinked) cache.set(`${r.question_id}|HI`, hasQuestionError(r.text, r.options, r.correct));
        return cache;
    }, [questions, enUnlinked, hiUnlinked]);
    const issueFor = useCallback((side, lang) => {
        if (!side?.question_id) return false;
        return issueCache.get(`${side.question_id}|${lang}`) || false;
    }, [issueCache]);

    // Mismatch cache too — text comparison + numeric extraction in hasAnswerMismatch
    // was running ~4 times per question on every render.
    const mismatchCache = useMemo(() => {
        const cache = new Map();
        for (const q of questions) {
            if (!q.link_id) continue;
            cache.set(q.link_id, hasAnswerMismatch(q.en, q.hi));
        }
        return cache;
    }, [questions]);

    // Preserve the API's section order (each section's first appearance in `questions`),
    // then sort within each section by q_int of the active language.
    const sectionFirstIdx = useMemo(() => {
        const m = {};
        questions.forEach((q, i) => {
            const code = q.section_code || 'Other';
            if (!(code in m)) m[code] = i;
        });
        return m;
    }, [questions]);

    const filteredQuestions = useMemo(() => questions.filter(q => {
        const enDone = q.en?.solution_status === 'DONE';
        const hiDone = q.hi?.solution_status === 'DONE';
        if (filter === 'both_solved') return enDone && hiDone;
        if (filter === 'unsolved') return !enDone || !hiDone;
        if (filter === 'mismatch') return mismatchCache.get(q.link_id) || false;
        if (filter === 'issues') return issueFor(q.en, 'EN') || issueFor(q.hi, 'HI');
        if (filter === 'figures') return !!(q.en?.figure_prompt || q.en?.figure_helpful);
        return true;
    }).slice().sort((a, b) => {
        const aSec = a.section_code || 'Other';
        const bSec = b.section_code || 'Other';
        if (aSec !== bSec) {
            return (sectionFirstIdx[aSec] ?? Infinity) - (sectionFirstIdx[bSec] ?? Infinity);
        }
        const aInt = sidebarLang === 'EN' ? (a.en?.q_int ?? Infinity) : (a.hi?.q_int ?? Infinity);
        const bInt = sidebarLang === 'EN' ? (b.en?.q_int ?? Infinity) : (b.hi?.q_int ?? Infinity);
        return aInt - bInt;
    }), [questions, filter, sidebarLang, sectionFirstIdx, mismatchCache, issueFor]);

    const { bothSolvedCount, mismatchCount, figuresCount, issueCount } = useMemo(() => {
        let bothSolved = 0, mismatch = 0, figures = 0, issues = 0;
        for (const q of questions) {
            if (q.en?.solution_status === 'DONE' && q.hi?.solution_status === 'DONE') bothSolved++;
            if (mismatchCache.get(q.link_id)) mismatch++;
            if (q.en?.figure_prompt || q.en?.figure_helpful) figures++;
            if (issueFor(q.en, 'EN') || issueFor(q.hi, 'HI')) issues++;
        }
        return { bothSolvedCount: bothSolved, mismatchCount: mismatch, figuresCount: figures, issueCount: issues };
    }, [questions, mismatchCache, issueFor]);

    // Group by section for sidebar (linked-only — kept for legacy refs).
    const groupedQuestions = useMemo(() => questions.reduce((acc, q) => {
        const sec = q.section_code || 'Other';
        if (!acc[sec]) acc[sec] = [];
        acc[sec].push(q);
        return acc;
    }, {}), [questions]);

    // Unified per-language sidebar items: linked pairs viewed from `sidebarLang`
    // plus the standalone rows in that language. Items are grouped by section
    // and sorted by question_number_int within each section.
    const sidebarSections = useMemo(() => {
        const buckets = {}; // section_code -> { items: [], doneCount: 0 }
        const push = (sectionCode, item) => {
            const key = sectionCode || 'Other';
            if (!buckets[key]) buckets[key] = { items: [], doneCount: 0 };
            buckets[key].items.push(item);
            if (item.sideDone) buckets[key].doneCount += 1;
        };
        for (const q of questions) {
            const side = sidebarLang === 'EN' ? q.en : q.hi;
            if (!side) continue;
            const other = sidebarLang === 'EN' ? q.hi : q.en;
            push(q.section_code, {
                kind: 'linked',
                key: q.link_id,
                anchorId: `bp-${q.link_id}`,
                q_no: side.q_no,
                q_int: side.q_int,
                sideDone: side.solution_status === 'DONE',
                otherDone: other?.solution_status === 'DONE',
                hasIssue: issueFor(side, sidebarLang),
                mismatch: mismatchCache.get(q.link_id) || false,
                standalone: false,
            });
        }
        const standalones = sidebarLang === 'EN' ? enUnlinked : hiUnlinked;
        for (const r of standalones) {
            const anchorPrefix = sidebarLang === 'EN' ? 'en-only' : 'hi-only';
            push(r.section_code, {
                kind: 'standalone',
                key: `${anchorPrefix}-${r.question_id}`,
                anchorId: `bp-${anchorPrefix}-${r.question_id}`,
                q_no: r.q_no,
                q_int: r.q_int,
                sideDone: r.solution_status === 'DONE',
                otherDone: false,
                hasIssue: issueFor(r, sidebarLang),
                mismatch: false,
                standalone: true,
            });
        }
        return Object.entries(buckets)
            .map(([section, info]) => ({
                section,
                doneCount: info.doneCount,
                items: info.items.slice().sort((a, b) => (a.q_int ?? Infinity) - (b.q_int ?? Infinity)),
            }))
            .sort((a, b) => a.section.localeCompare(b.section));
    }, [questions, enUnlinked, hiUnlinked, sidebarLang, issueFor, mismatchCache]);

    // Section-wise triage: linked pairs, unlinked standalone rows (deduped by q_int across EN+HI),
    // and numeric gaps within each section's observed question_number range.
    const sectionStats = useMemo(() => {
        const buckets = {};
        const ensure = (code) => {
            const k = code || 'Other';
            if (!buckets[k]) buckets[k] = { code: k, linked: 0, unlinkedEn: new Set(), unlinkedHi: new Set(), qNos: new Set() };
            return buckets[k];
        };
        for (const q of questions) {
            const b = ensure(q.section_code);
            b.linked += 1;
            const qInt = q.en?.q_int ?? q.hi?.q_int;
            if (Number.isInteger(qInt)) b.qNos.add(qInt);
        }
        for (const r of enUnlinked) {
            const b = ensure(r.section_code);
            if (Number.isInteger(r.q_int)) { b.unlinkedEn.add(r.q_int); b.qNos.add(r.q_int); }
            else b.unlinkedEn.add(`row-${r.question_id}`);
        }
        for (const r of hiUnlinked) {
            const b = ensure(r.section_code);
            if (Number.isInteger(r.q_int)) { b.unlinkedHi.add(r.q_int); b.qNos.add(r.q_int); }
            else b.unlinkedHi.add(`row-${r.question_id}`);
        }
        return Object.values(buckets).map(b => {
            // Unlinked count: same q_int present on both sides without a link is still
            // one logical missing pair, so union the two sets before counting.
            const unlinkedNums = new Set([...b.unlinkedEn, ...b.unlinkedHi]);
            const unlinked = unlinkedNums.size;
            let missing = 0;
            if (b.qNos.size > 0) {
                const nums = [...b.qNos].filter(Number.isInteger).sort((a, c) => a - c);
                if (nums.length > 0) {
                    const span = nums[nums.length - 1] - nums[0] + 1;
                    missing = Math.max(0, span - nums.length);
                }
            }
            return {
                code: b.code,
                linked: b.linked,
                unlinked,
                missing,
                total: b.linked + unlinked + missing,
            };
        }).sort((a, c) => a.code.localeCompare(c.code));
    }, [questions, enUnlinked, hiUnlinked]);

    // Pairs of standalone EN+HI rows that share a question_number_int — the
    // "auto-link by Q No." bulk action operates on this. Memoized so the IIFE
    // in the render path doesn't recompute on every keystroke elsewhere.
    const autoMatches = useMemo(() => {
        const hiByQ = new Map();
        for (const r of hiUnlinked) {
            if (Number.isInteger(r.q_int)) hiByQ.set(r.q_int, r);
        }
        const out = [];
        for (const r of enUnlinked) {
            if (Number.isInteger(r.q_int) && hiByQ.has(r.q_int)) {
                const hi = hiByQ.get(r.q_int);
                out.push({
                    english_question_id: r.question_id,
                    english_version_no: r.version_no,
                    hindi_question_id: hi.question_id,
                    hindi_version_no: hi.version_no,
                });
            }
        }
        return out;
    }, [enUnlinked, hiUnlinked]);

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
                            {issueCount > 0 && <span className="text-pink-600 ml-1">({issueCount} quality issues)</span>}
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
                                { key: 'issues', label: `Issues (${issueCount})` },
                                { key: 'figures', label: `Figures (${figuresCount})` },
                            ].map(f => (
                                <button key={f.key} onClick={() => setFilter(f.key)}
                                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${filter === f.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                    {f.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-1.5 ml-auto">
                            <button onClick={() => setAddOpen(true)}
                                className="px-3 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-300 rounded-md hover:bg-emerald-100">
                                + Add Missing Q
                            </button>
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

                {/* Row 3: Section-wise difficulty table (minimizable) */}
                {selectedPair && sectionStats.length > 0 && (
                    <div className="border border-gray-100 rounded">
                        <button
                            type="button"
                            onClick={() => setStatsCollapsed(c => !c)}
                            className="w-full px-2 py-1 flex items-center justify-between text-xs font-semibold text-gray-600 hover:bg-gray-50"
                            title={statsCollapsed ? 'Show section stats' : 'Hide section stats'}
                        >
                            <span>
                                Section stats
                                {statsCollapsed && (
                                    <span className="ml-2 text-gray-400 font-normal">
                                        ({questions.length} qs · {sectionStats.length} section{sectionStats.length === 1 ? '' : 's'})
                                    </span>
                                )}
                            </span>
                            <span className="text-gray-400">{statsCollapsed ? '▸' : '▾'}</span>
                        </button>
                        {!statsCollapsed && (
                            <div className="overflow-x-auto border-t border-gray-100">
                                <table className="w-full text-xs border-collapse">
                                    <thead>
                                        <tr className="text-gray-500 uppercase">
                                            <th className="text-left font-semibold px-2 py-1">Section</th>
                                            <th className="text-center font-semibold px-2 py-1 text-green-700">Linked</th>
                                            <th className="text-center font-semibold px-2 py-1 text-amber-700">Unlinked</th>
                                            <th className="text-center font-semibold px-2 py-1 text-red-700">Missing</th>
                                            <th className="text-center font-semibold px-2 py-1">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sectionStats.map(s => (
                                            <tr key={s.code} className="border-t border-gray-100">
                                                <td className="px-2 py-1 font-semibold text-gray-700">{s.code}</td>
                                                <td className="text-center px-2 py-1"><span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">{s.linked}</span></td>
                                                <td className="text-center px-2 py-1"><span className={`px-1.5 py-0.5 rounded font-bold ${s.unlinked > 0 ? 'bg-amber-100 text-amber-700' : 'text-gray-400'}`}>{s.unlinked || '-'}</span></td>
                                                <td className="text-center px-2 py-1"><span className={`px-1.5 py-0.5 rounded font-bold ${s.missing > 0 ? 'bg-red-100 text-red-700' : 'text-gray-400'}`}>{s.missing || '-'}</span></td>
                                                <td className="text-center px-2 py-1 font-semibold">{s.total}</td>
                                            </tr>
                                        ))}
                                        {sectionStats.length > 1 && (() => {
                                            const sum = (k) => sectionStats.reduce((a, r) => a + (r[k] || 0), 0);
                                            return (
                                                <tr className="border-t border-gray-300 font-bold">
                                                    <td className="px-2 py-1 text-gray-700">Total</td>
                                                    <td className="text-center px-2 py-1"><span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{sum('linked')}</span></td>
                                                    <td className="text-center px-2 py-1"><span className={`px-1.5 py-0.5 rounded ${sum('unlinked') > 0 ? 'bg-amber-100 text-amber-700' : 'text-gray-400'}`}>{sum('unlinked') || '-'}</span></td>
                                                    <td className="text-center px-2 py-1"><span className={`px-1.5 py-0.5 rounded ${sum('missing') > 0 ? 'bg-red-100 text-red-700' : 'text-gray-400'}`}>{sum('missing') || '-'}</span></td>
                                                    <td className="text-center px-2 py-1 font-bold">{sum('total')}</td>
                                                </tr>
                                            );
                                        })()}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar */}
                {selectedPair && (questions.length > 0 || enUnlinked.length > 0 || hiUnlinked.length > 0) && (
                    <aside className="w-56 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto p-3">
                        {/* Language toggle */}
                        <div className="flex items-center gap-1 mb-3 pb-2 border-b border-gray-100">
                            <span className="text-[10px] font-semibold text-gray-500 uppercase mr-1">View</span>
                            {[
                                { val: 'EN', label: 'English' },
                                { val: 'HI', label: 'Hindi' },
                            ].map(opt => (
                                <button key={opt.val}
                                    onClick={() => setSidebarLang(opt.val)}
                                    className={`text-[11px] font-semibold px-2 py-0.5 rounded transition-colors ${
                                        sidebarLang === opt.val
                                            ? (opt.val === 'EN' ? 'bg-blue-600 text-white' : 'bg-orange-600 text-white')
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        <div className="space-y-4">
                            {sidebarSections.map(({ section, items, doneCount }) => (
                                <div key={section}>
                                    <div className="flex justify-between items-center mb-2">
                                        <h4 className="text-xs font-bold text-gray-700 truncate" title={section}>{section}</h4>
                                        <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{doneCount}/{items.length}</span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-1.5">
                                        {items.map(item => {
                                            const qLabel = item.q_no ? String(item.q_no).replace(/Q\.\s*/, '').trim() : '?';

                                            let colorClass;
                                            if (item.hasIssue) {
                                                colorClass = 'text-white bg-pink-600 border-pink-700 ring-1 ring-pink-400';
                                            } else if (item.mismatch) {
                                                colorClass = 'text-white bg-red-600 border-red-700';
                                            } else if (item.standalone) {
                                                // Standalone row in the viewed language — distinct purple shade.
                                                colorClass = item.sideDone
                                                    ? 'text-purple-700 bg-purple-50 border-purple-300 hover:bg-purple-100'
                                                    : 'text-purple-800 bg-purple-100 border-purple-400 hover:bg-purple-200 ring-1 ring-purple-300';
                                            } else if (item.sideDone && item.otherDone) {
                                                colorClass = 'text-gray-600 bg-green-50 border-green-200 hover:bg-green-100';
                                            } else if (item.sideDone || item.otherDone) {
                                                colorClass = 'text-amber-700 bg-amber-50 border-amber-300 hover:bg-amber-100';
                                            } else {
                                                colorClass = 'text-red-700 bg-red-50 border-red-300 hover:bg-red-100';
                                            }

                                            const titleParts = [`Q.${qLabel}`];
                                            if (item.standalone) titleParts.push(`Standalone ${sidebarLang}`);
                                            else titleParts.push(`${sidebarLang}:${item.sideDone ? 'DONE' : 'PENDING'} other:${item.otherDone ? 'DONE' : 'PENDING'}`);
                                            if (item.mismatch) titleParts.push('MISMATCH');
                                            if (item.hasIssue) titleParts.push('⚠ QUALITY ISSUE');

                                            return (
                                                <a key={item.key}
                                                    href={`#${item.anchorId}`}
                                                    onClick={e => {
                                                        e.preventDefault();
                                                        document.getElementById(item.anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                    }}
                                                    className={`relative flex items-center justify-center aspect-square text-xs font-medium rounded border transition-colors ${colorClass}`}
                                                    title={titleParts.join(' · ')}
                                                >
                                                    {qLabel}
                                                    {item.standalone && (
                                                        <span className="absolute -top-1 -right-1 text-[8px] font-bold bg-white text-purple-700 border border-purple-400 rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
                                                            !
                                                        </span>
                                                    )}
                                                </a>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                            {sidebarSections.length === 0 && (
                                <div className="text-xs text-gray-400 italic text-center py-4">
                                    No {sidebarLang === 'EN' ? 'English' : 'Hindi'} questions in this paper pair.
                                </div>
                            )}
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

                            {(() => {
                                const showAutoLink = autoMatches.length > 0;
                                const autoLinkBtn = showAutoLink && (
                                    <button
                                        type="button"
                                        disabled={linking}
                                        onClick={() => {
                                            if (!confirm(`Auto-link ${autoMatches.length} EN+HI pair${autoMatches.length === 1 ? '' : 's'} with matching question numbers?`)) return;
                                            linkPairs(autoMatches);
                                        }}
                                        className="px-3 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-300 rounded hover:bg-emerald-100 disabled:opacity-50"
                                    >
                                        {linking ? 'Linking…' : `Auto-link by Q No. (${autoMatches.length} match${autoMatches.length === 1 ? '' : 'es'})`}
                                    </button>
                                );

                                const enSection = (
                                    <>
                                        {enUnlinked.length > 0 && (
                                            <div className="pt-8">
                                                <div className="mb-3 flex items-center gap-3 flex-wrap">
                                                    <h2 className="text-sm font-bold text-blue-800 uppercase tracking-wide">
                                                        Standalone English Questions
                                                    </h2>
                                                    <span className="text-xs text-gray-500">
                                                        {enUnlinked.length} unlinked
                                                    </span>
                                                    {autoLinkBtn}
                                                </div>
                                                <div className="space-y-4">
                                                    {enUnlinked.map((row, idx) => {
                                                        const pseudoPair = {
                                                            link_id: `en-only-${row.question_id}`,
                                                            section_code: row.section_code,
                                                            en: row,
                                                            hi: null,
                                                        };
                                                        return (
                                                            <div key={pseudoPair.link_id} id={`bp-${pseudoPair.link_id}`}>
                                                                <StandaloneLinkPicker
                                                                    side="en"
                                                                    row={row}
                                                                    candidates={hiUnlinked}
                                                                    onLink={(pair) => linkPairs([pair])}
                                                                    busy={linking}
                                                                />
                                                                <BilingualCard pair={pseudoPair} idx={idx} onDifficultyChange={handleDifficultyChange} />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                    </>
                                );
                                const hiSection = (
                                    <>
                                        {hiUnlinked.length > 0 && (
                                            <div className="pt-8">
                                                <div className="mb-3 flex items-center gap-3 flex-wrap">
                                                    <h2 className="text-sm font-bold text-orange-800 uppercase tracking-wide">
                                                        Standalone Hindi Questions
                                                    </h2>
                                                    <span className="text-xs text-gray-500">
                                                        {hiUnlinked.length} unlinked
                                                    </span>
                                                    {/* Show the auto-link button here too only when the EN section is hidden,
                                                        so we never render two identical buttons. */}
                                                    {enUnlinked.length === 0 && autoLinkBtn}
                                                </div>
                                                <div className="space-y-4">
                                                    {hiUnlinked.map((row, idx) => {
                                                        const pseudoPair = {
                                                            link_id: `hi-only-${row.question_id}`,
                                                            section_code: row.section_code,
                                                            en: null,
                                                            hi: row,
                                                        };
                                                        return (
                                                            <div key={pseudoPair.link_id} id={`bp-${pseudoPair.link_id}`}>
                                                                <StandaloneLinkPicker
                                                                    side="hi"
                                                                    row={row}
                                                                    candidates={enUnlinked}
                                                                    onLink={(pair) => linkPairs([pair])}
                                                                    busy={linking}
                                                                />
                                                                <BilingualCard pair={pseudoPair} idx={idx} onDifficultyChange={handleDifficultyChange} />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                );
                                // Render the active-language standalone section first so the page
                                // visually leads with the language the sidebar is showing.
                                return sidebarLang === 'HI'
                                    ? <>{hiSection}{enSection}</>
                                    : <>{enSection}{hiSection}</>;
                            })()}

                            {loadingUnlinked && (
                                <div className="pt-6 text-center text-xs text-gray-400">
                                    Loading standalone questions…
                                </div>
                            )}
                        </div>
                    )}
                </main>
            </div>

            <AddMissingQuestionModal
                open={addOpen && !!selectedPair}
                onClose={() => setAddOpen(false)}
                selectedPair={selectedPair}
                sections={sections}
                existingQNos={[
                    ...questions.map(q => q.en?.q_no || q.hi?.q_no).filter(Boolean),
                    ...enUnlinked.map(r => r.q_no).filter(Boolean),
                    ...hiUnlinked.map(r => r.q_no).filter(Boolean),
                ]}
                onCreated={() => {
                    if (selectedPair?.en_session_id && selectedPair?.hi_session_id) {
                        loadQuestions(selectedPair.en_session_id, selectedPair.hi_session_id);
                    }
                    setFeedback({ type: 'success', msg: 'Question created — list reloaded' });
                    setTimeout(() => setFeedback(null), 3000);
                }}
            />
        </div>
    );
}
