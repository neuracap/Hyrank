'use client';

import { useState, useEffect, useMemo, useCallback, useRef, memo, lazy, Suspense } from 'react';
import Latex from '@/components/Latex';
import { checkQuestionQuality, checkSolutionQuality, checkBilingualPair, hasQuestionError } from '@/lib/question-checks';
const FigureEditor = lazy(() => import('@/components/FigureEditor'));

const DIFF_LABELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const DIFF_COLORS = { 1: 'bg-green-100 text-green-700', 2: 'bg-yellow-100 text-yellow-700', 3: 'bg-red-100 text-red-700' };

function toArray(v) { return Array.isArray(v) ? v : []; }

// Issue types we intentionally do NOT surface on this page.
// (Other pages still see them via the shared lib/question-checks.js.)
//
//   missing_image      → "Text mentions figure/diagram but no image found"
//   figure_missing     → "Solution flagged as needing a figure but none attached"
//   subtype_mismatch   → "Subtype mismatch: EN=X HI=Y"
//   q_no_mismatch      → "Question number mismatch: EN=X HI=Y"
//                        (papers routinely shuffle EN vs HI question order,
//                         so a position-number mismatch isn't actionable here)
//   missing_en         → "No English counterpart linked"
//   missing_hi         → "No Hindi counterpart linked"
//                        (the page already renders standalones in their own
//                         sections with a clear "no counterpart" panel — a
//                         per-card warning on top is just noise)
//   raw_image_ref      → "Question has raw image file reference (.jpg/.png)"
//                        (not actionable on its own; if the image is broken
//                         the empty_image_link / missing_image checks fire)
//
// These tend to be noisy on already-reviewed production content; the
// reviewer wants to focus on substantive errors: duplicated options,
// missing correct answer, missing core answer basis, missing solution,
// and EN↔HI answer-text mismatches.
const SUPPRESSED_ISSUE_TYPES = new Set([
    'missing_image',
    'figure_missing',
    'subtype_mismatch',
    'q_no_mismatch',
    'missing_en',
    'missing_hi',
    'raw_image_ref',
]);

// Issue types whose severity is bumped to 'error' on this page (and thus
// trigger the red card border + Errors filter). Reviewer wants production
// content to never be missing these.
//
//   core_basis_empty   → "Core Answer Basis is empty"  (default: warning)
//   solution_empty is already 'error' in the shared lib, so it's already covered.
const PROMOTED_TO_ERROR = new Set(['core_basis_empty']);

function filterIssues(issues) {
    return (issues || [])
        .filter(i => !SUPPRESSED_ISSUE_TYPES.has(i?.type))
        .map(i => (i && PROMOTED_TO_ERROR.has(i.type)) ? { ...i, severity: 'error' } : i);
}

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

function hasAnswerMismatch(en, hi) {
    const enLabel = getCorrectLabel(en);
    const hiLabel = getCorrectLabel(hi);
    if (!enLabel || !hiLabel) return false;

    const normalize = (t) => (t || '').replace(/\s+/g, ' ').replace(/\$/g, '').trim().toLowerCase();

    const enOpts = en.options || [];
    const hiOpts = hi.options || [];
    const enCorrectText = enOpts.find(o => o.option_key === enLabel)?.opt_text;
    const hiCorrectText = hiOpts.find(o => o.option_key === hiLabel)?.opt_text;

    if (!enCorrectText || !hiCorrectText) return enLabel !== hiLabel;

    const enNorm = normalize(enCorrectText);
    const hiNorm = normalize(hiCorrectText);
    if (enNorm === hiNorm) return false;

    const enTextInHi = hiOpts.find(o => normalize(o.opt_text) === enNorm);
    if (enTextInHi) return enTextInHi.option_key !== hiLabel;

    const hiTextInEn = enOpts.find(o => normalize(o.opt_text) === hiNorm);
    if (hiTextInEn) return hiTextInEn.option_key !== enLabel;

    const extractNumeric = (t) => t.replace(/[^\d.+\-*/=<>%()^,]/g, '').trim();
    const enNum = extractNumeric(enNorm);
    const hiNum = extractNumeric(hiNorm);
    if (enNum && hiNum && enNum.length >= 1) {
        if (enNum === hiNum) return false;
        const enNumInHi = hiOpts.find(o => extractNumeric(normalize(o.opt_text)) === enNum);
        if (enNumInHi) return enNumInHi.option_key !== hiLabel;
    }

    return false;
}

function sectionsToText(sections) {
    return toArray(sections).map(s => {
        const prefix = s.key ? `[${s.key}] ` : '';
        const content = (s.content || '').replace(/\\n/g, '\n');
        return prefix + content;
    }).join('\n\n');
}

function textToSections(text) {
    if (!text || !text.trim()) return [];
    const parts = text.split(/^(?=\[[a-z_]+\]\s)/m).filter(b => b.trim());
    return parts.map(part => {
        const match = part.match(/^\[([a-z_]+)\]\s*([\s\S]*)$/);
        if (match) return { key: match[1], content: match[2].trim() };
        return { key: 'exam_craft', content: part.trim() };
    });
}

// =========================================================
// Editable Panel — Question + Options + Correct + Solution (one language)
// =========================================================
function EditablePanel({ lang, data, label, editState, onEditChange, onTranslateFrom, translating, onCopyFrom, onSave, saving }) {
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
    const [editingSol, setEditingSol] = useState(false);
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
                question_id: data.question_id,
                version_no: data.version_no || 1,
                language: lang === 'en' ? 'EN' : 'HI',
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
                        onClick={() => {
                            // "Done" both collapses the editor AND persists —
                            // finishing an edit should save, not just hide it.
                            if (editingQuestion) onSave?.();
                            setEditingQuestion(v => !v);
                        }}
                        disabled={editingQuestion && saving}
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold disabled:opacity-50 ${editingQuestion ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50'}`}
                        title="Edit question stem and options"
                    >
                        {editingQuestion ? (saving ? 'Saving…' : 'Done') : 'Edit Q'}
                    </button>
                </div>
            </div>

            {/* Question text + options */}
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

            {/* Quality warnings — question + solution, deduped */}
            {(() => {
                const qIssues = filterIssues(checkQuestionQuality(data.text, data.options, editState.correct));
                const sIssues = filterIssues(checkSolutionQuality(data));
                const issues = [...qIssues, ...sIssues];
                if (issues.length === 0) return null;
                return (
                    <div className="px-3 py-1.5 border-b bg-pink-50 text-xs">
                        {issues.map((w, i) => (
                            <div key={i} className={`flex items-center gap-1.5 ${w.severity === 'error' ? 'text-red-700 font-semibold' : 'text-orange-700'}`}>
                                <span>{w.severity === 'error' ? '⛔' : '⚠️'}</span> {w.message}
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

            {/* Core Answer Basis — Latex-rendered when not editing the
                solution, textarea while editingSol is true so the
                reviewer can fix the raw \( ... \) string. */}
            <div className="px-3 py-1.5 border-b bg-blue-50">
                <label className="text-[10px] text-gray-500 uppercase font-semibold block mb-0.5">Core Answer Basis</label>
                {editingSol ? (
                    <textarea
                        value={editState.coreBasis || ''}
                        onChange={e => onEditChange({ ...editState, coreBasis: e.target.value })}
                        rows={Math.max(1, Math.ceil(((editState.coreBasis || '').length || 0) / 70) || 1)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-400 resize-y"
                        placeholder="One-line reason why this is correct..." />
                ) : (
                    (editState.coreBasis || '').trim()
                        ? <div className="text-xs text-gray-800"><Latex>{editState.coreBasis}</Latex></div>
                        : <div className="text-xs italic text-gray-400">No core answer basis.</div>
                )}
            </div>

            {/* Action row — minimal when not editing, full tools when editing */}
            <div className="px-3 py-1.5 border-b bg-gray-50 flex items-center gap-2 flex-wrap">
                {!editingSol ? (
                    <button onClick={() => setEditingSol(true)}
                        className="px-2 py-1 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700">
                        ✎ Edit Sol
                    </button>
                ) : (
                    <>
                        <button
                            onClick={() => { setEditingSol(false); onSave?.(); }}
                            disabled={saving}
                            className="px-2 py-1 text-xs font-semibold bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
                            {saving ? 'Saving…' : 'Done'}
                        </button>
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
                    </>
                )}
            </div>

            {/* Solution body — preview only by default, textarea + preview when editing */}
            <div className="px-3 py-2 flex-1 flex flex-col">
                {!editingSol ? (
                    editState.solutionText && editState.solutionText.trim() ? (
                        <div className="p-2 bg-gray-50 rounded border border-gray-200 text-xs space-y-1.5">
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
                    ) : (
                        <div className="text-xs italic text-gray-400 p-3 text-center">No solution text yet.</div>
                    )
                ) : (
                    <>
                        <div className="text-[10px] text-gray-400 mb-1">paste image (Ctrl+V) supported</div>
                        <textarea
                            value={editState.solutionText}
                            onChange={e => onEditChange({ ...editState, solutionText: e.target.value })}
                            onPaste={e => {
                                const role = 'solution_body';
                                handleImagePaste(
                                    e,
                                    editState.solutionText || '',
                                    (next) => onEditChange({ ...editState, solutionText: next }),
                                    null,
                                    role,
                                );
                            }}
                            rows={8}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
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

                        {showPreview && editState.solutionText && (
                            <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200 text-xs space-y-1.5">
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
                    </>
                )}
            </div>
        </div>
    );
}

// Visibility-gated mount: don't render heavy editors until the card is near the viewport.
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
// Bilingual question pair card — Hindi LEFT, English RIGHT
// =========================================================
const BilingualCard = memo(function BilingualCard({ pair, idx, onDifficultyChange }) {
    const [expanded, setExpanded] = useState(true);
    const rootRef = useRef(null);
    const hasBeenVisible = useHasBeenVisible(rootRef);

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
        pair.en?.solution_json?.answer_outcome?.figure_url || ''
    );
    const [uploadingFigure, setUploadingFigure] = useState(false);
    const [editingFigure, setEditingFigure] = useState(false);

    const enDone = pair.en?.solution_status === 'DONE';
    const hiDone = pair.hi?.solution_status === 'DONE';
    const bothDone = enDone && hiDone;
    const enLive = { correct: enEdit.correct || getCorrectLabel(pair.en), options: pair.en?.options || [] };
    const hiLive = { correct: hiEdit.correct || getCorrectLabel(pair.hi), options: pair.hi?.options || [] };
    const answerMismatch = hasAnswerMismatch(enLive, hiLive);

    // Aggregate all heuristic issues so the card border + header badge
    // accurately reflect what the reviewer needs to fix.
    const enQIssues  = pair.en ? filterIssues(checkQuestionQuality(pair.en.text, pair.en.options, enLive.correct)) : [];
    const hiQIssues  = pair.hi ? filterIssues(checkQuestionQuality(pair.hi.text, pair.hi.options, hiLive.correct)) : [];
    const enSolIssues = pair.en ? filterIssues(checkSolutionQuality(pair.en)) : [];
    const hiSolIssues = pair.hi ? filterIssues(checkSolutionQuality(pair.hi)) : [];
    const pairIssues  = filterIssues(checkBilingualPair(pair.en, pair.hi, { section_code: pair.section_code }));
    const allIssues = [
        ...enQIssues.map(i => ({ ...i, scope: 'EN' })),
        ...hiQIssues.map(i => ({ ...i, scope: 'HI' })),
        ...enSolIssues.map(i => ({ ...i, scope: 'EN sol' })),
        ...hiSolIssues.map(i => ({ ...i, scope: 'HI sol' })),
        ...pairIssues.map(i => ({ ...i, scope: 'Pair' })),
    ];
    const errorCount   = allIssues.filter(i => i.severity === 'error').length;
    const warningCount = allIssues.filter(i => i.severity === 'warning').length;
    const issueTitle = allIssues.map(i => `[${i.scope}] ${i.message}`).join('\n');

    const cardBorder = errorCount > 0
        ? 'border-2 border-red-500 ring-2 ring-red-200 bg-red-50/30'
        : warningCount > 0
            ? 'border border-amber-300 bg-amber-50/20'
            : bothDone
                ? 'border border-gray-200'
                : 'border border-amber-300';

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

    const handleCopy = (targetLang) => {
        if (targetLang === 'en') {
            setEnEdit(prev => ({ ...prev, solutionText: hiEdit.solutionText }));
        } else {
            setHiEdit(prev => ({ ...prev, solutionText: enEdit.solutionText }));
        }
    };

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
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setSaveMsg('Saved!');
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
        <div ref={rootRef} className={`rounded-lg overflow-hidden ${cardBorder}`}>
            {/* Pair header */}
            <div className="px-3 py-1.5 bg-gray-50 border-b flex items-center justify-between">
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
                    <span className="text-xs font-bold text-gray-600">#{idx + 1}</span>
                    {pair.section_code && <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{pair.section_code}</span>}
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
                        <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold"
                            title="Correct option is set to different choices on EN vs HI">
                            ANSWER MISMATCH: EN={enEdit.correct} HI={hiEdit.correct}
                        </span>
                    )}
                    {errorCount > 0 && (
                        <span className="text-xs bg-red-600 text-white px-1.5 py-0.5 rounded font-bold" title={issueTitle}>
                            ⛔ {errorCount} error{errorCount === 1 ? '' : 's'}
                        </span>
                    )}
                    {warningCount > 0 && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold" title={issueTitle}>
                            ⚠️ {warningCount} warning{warningCount === 1 ? '' : 's'}
                        </span>
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

            {/* Inline pair-level issue strip — pair issues belong to the
                whole card, not one panel, so surface them right under the
                header instead of duplicating them on each side. */}
            {expanded && pairIssues.length > 0 && (
                <div className="px-3 py-1.5 bg-yellow-50 border-b border-yellow-200 text-xs space-y-0.5">
                    {pairIssues.map((w, i) => (
                        <div key={i} className={`flex items-center gap-1.5 ${w.severity === 'error' ? 'text-red-700 font-semibold' : 'text-orange-700'}`}>
                            <span>{w.severity === 'error' ? '⛔' : '⚠️'}</span> {w.message}
                        </div>
                    ))}
                </div>
            )}

            {/* HINDI on LEFT, ENGLISH on RIGHT */}
            {expanded && !hasBeenVisible && (
                <div className="px-4 py-8 text-center text-xs text-gray-400 italic border-t border-gray-100">
                    Scrolling reveals the editor…
                </div>
            )}
            {expanded && hasBeenVisible && (
                <>
                    <div className="flex divide-x divide-gray-200">
                        <EditablePanel
                            lang="hi" data={pair.hi} label="Hindi"
                            editState={hiEdit} onEditChange={setHiEdit}
                            onTranslateFrom={() => handleTranslate('hi')}
                            translating={translatingHi}
                            onCopyFrom={() => handleCopy('hi')}
                            onSave={handleSave} saving={saving}
                        />
                        <EditablePanel
                            lang="en" data={pair.en} label="English"
                            editState={enEdit} onEditChange={setEnEdit}
                            onTranslateFrom={() => handleTranslate('en')}
                            translating={translatingEn}
                            onCopyFrom={() => handleCopy('en')}
                            onSave={handleSave} saving={saving}
                        />
                    </div>

                    {/* Figure upload (shared for the pair) */}
                    <div className="px-4 py-3 border-t border-gray-200 bg-amber-50/50">
                        <div className="flex items-center gap-2 mb-1">
                            <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Solution Figure</label>
                        </div>
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
                                                                question_id: pair.en?.question_id || pair.hi?.question_id,
                                                                language: pair.en ? 'EN' : 'HI',
                                                                version_no: (pair.en?.version_no || pair.hi?.version_no),
                                                                role: 'solution_figure',
                                                            }),
                                                        });
                                                        const data = await res.json();
                                                        const url = data.url || data.secure_url || data.latexPath;
                                                        if (url) {
                                                            setFigureUrl(url);
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
                                                                body: JSON.stringify({
                                                                    link_id: pair.link_id,
                                                                    en: saveFigure(pair.en),
                                                                    hi: saveFigure(pair.hi),
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
                                        : <span className="text-xs text-amber-600">Paste figure here (Ctrl+V) — optional</span>
                                    }
                                </div>
                            )}
                        </div>
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
                                            question_id: pair.en?.question_id || pair.hi?.question_id,
                                            language: pair.en ? 'EN' : 'HI',
                                            version_no: (pair.en?.version_no || pair.hi?.version_no),
                                            role: 'solution_figure',
                                        }),
                                    });
                                    const data = await res.json();
                                    const url = data.url || data.secure_url || data.latexPath;
                                    if (url) {
                                        setFigureUrl(url);
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
// Main Component — production review (no question palette)
// =========================================================
export default function ReviewProductionBilingual({ exams }) {
    const [selectedExamId, setSelectedExamId] = useState('');
    const [papers, setPapers] = useState([]);
    const [loadingPapers, setLoadingPapers] = useState(false);
    const [selectedPair, setSelectedPair] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [filter, setFilter] = useState('all');
    const [feedback, setFeedback] = useState(null);
    const [enUnlinked, setEnUnlinked] = useState([]);
    const [hiUnlinked, setHiUnlinked] = useState([]);
    const [loadingUnlinked, setLoadingUnlinked] = useState(false);

    const handleExamChange = async (examId) => {
        setSelectedExamId(examId);
        setSelectedPair(null);
        setQuestions([]);
        setEnUnlinked([]);
        setHiUnlinked([]);
        setPapers([]);
        if (!examId) return;

        setLoadingPapers(true);
        try {
            const res = await fetch(`/api/solution-review/production-bilingual-papers?exam_id=${examId}`);
            const data = await res.json();
            setPapers(res.ok ? (data.papers || []) : []);
        } catch { setPapers([]); }
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

    const handlePaperChange = async (val) => {
        if (!val) return;
        const [enId, hiId] = val.split('|');
        const pair = papers.find(p => p.en_session_id === enId && p.hi_session_id === hiId);
        setSelectedPair(pair);
        setQuestions([]);
        setFilter('all');
        await loadQuestions(enId, hiId);
    };

    const handleDifficultyChange = useCallback(async (questionId, versionNo, newDifficulty, primaryLang = 'EN') => {
        setQuestions(prev => prev.map(q =>
            q.en?.question_id === questionId
                ? { ...q, en: { ...q.en, difficulty: newDifficulty }, hi: q.hi ? { ...q.hi, difficulty: newDifficulty } : q.hi }
                : q.hi?.question_id === questionId
                    ? { ...q, hi: { ...q.hi, difficulty: newDifficulty }, en: q.en ? { ...q.en, difficulty: newDifficulty } : q.en }
                    : q
        ));

        try {
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
                pushSave(questionId, versionNo, primaryLang, '');
            }
            await Promise.all(saves);
        } catch (e) { console.error('Difficulty update error:', e); }
    }, [questions]);

    // Comprehensive per-pair issue counts: combines question, solution,
    // and pair heuristics into { errors, warnings } per link_id.
    const issueCacheMap = useMemo(() => {
        const map = new Map();
        for (const q of questions) {
            const key = q.link_id ?? `en-${q.en?.question_id}` ?? `hi-${q.hi?.question_id}`;
            if (!key) continue;
            const enCorrect = getCorrectLabel(q.en);
            const hiCorrect = getCorrectLabel(q.hi);
            const issues = [
                ...(q.en ? filterIssues(checkQuestionQuality(q.en.text, q.en.options, enCorrect)) : []),
                ...(q.hi ? filterIssues(checkQuestionQuality(q.hi.text, q.hi.options, hiCorrect)) : []),
                ...(q.en ? filterIssues(checkSolutionQuality(q.en)) : []),
                ...(q.hi ? filterIssues(checkSolutionQuality(q.hi)) : []),
                ...filterIssues(checkBilingualPair(q.en, q.hi, { section_code: q.section_code })),
            ];
            const errors   = issues.filter(i => i.severity === 'error').length;
            const warnings = issues.filter(i => i.severity === 'warning').length;
            map.set(key, { errors, warnings });
        }
        return map;
    }, [questions]);
    const issuesForPair = useCallback((q) => {
        const key = q.link_id ?? `en-${q.en?.question_id}` ?? `hi-${q.hi?.question_id}`;
        return issueCacheMap.get(key) || { errors: 0, warnings: 0 };
    }, [issueCacheMap]);

    const mismatchCache = useMemo(() => {
        const cache = new Map();
        for (const q of questions) {
            if (!q.link_id) continue;
            cache.set(q.link_id, hasAnswerMismatch(q.en, q.hi));
        }
        return cache;
    }, [questions]);

    const filteredQuestions = useMemo(() => questions.filter(q => {
        const enDone = q.en?.solution_status === 'DONE';
        const hiDone = q.hi?.solution_status === 'DONE';
        const counts = issuesForPair(q);
        if (filter === 'both_solved') return enDone && hiDone;
        if (filter === 'unsolved') return !enDone || !hiDone;
        if (filter === 'mismatch') return mismatchCache.get(q.link_id) || false;
        if (filter === 'errors')   return counts.errors > 0;
        if (filter === 'issues')   return counts.errors > 0 || counts.warnings > 0;
        return true;
    }).slice().sort((a, b) => {
        const aSec = a.section_code || 'Other';
        const bSec = b.section_code || 'Other';
        if (aSec !== bSec) return aSec.localeCompare(bSec);
        const aInt = a.hi?.q_int ?? a.en?.q_int ?? Infinity;
        const bInt = b.hi?.q_int ?? b.en?.q_int ?? Infinity;
        return aInt - bInt;
    }), [questions, filter, mismatchCache, issuesForPair]);

    // Standalone (no-counterpart) rows are only useful to surface here
    // when they have actionable issues. Otherwise they bloat the list of
    // already-verified production content. Same heuristic stack as the
    // pair check, minus the cross-language pair issues (the standalone
    // panel itself signals "no counterpart" without a warning entry).
    const standaloneHasIssues = useCallback((row) => {
        if (!row) return false;
        const correct = getCorrectLabel(row);
        const qIssues = filterIssues(checkQuestionQuality(row.text, row.options, correct));
        const sIssues = filterIssues(checkSolutionQuality(row));
        return qIssues.length + sIssues.length > 0;
    }, []);
    const visibleHiUnlinked = useMemo(
        () => hiUnlinked.filter(standaloneHasIssues),
        [hiUnlinked, standaloneHasIssues]
    );
    const visibleEnUnlinked = useMemo(
        () => enUnlinked.filter(standaloneHasIssues),
        [enUnlinked, standaloneHasIssues]
    );

    const { bothSolvedCount, mismatchCount, errorCount, warningCount } = useMemo(() => {
        let bothSolved = 0, mismatch = 0, errors = 0, warnings = 0;
        for (const q of questions) {
            if (q.en?.solution_status === 'DONE' && q.hi?.solution_status === 'DONE') bothSolved++;
            if (mismatchCache.get(q.link_id)) mismatch++;
            const c = issuesForPair(q);
            if (c.errors > 0) errors++;
            if (c.warnings > 0) warnings++;
        }
        return { bothSolvedCount: bothSolved, mismatchCount: mismatch, errorCount: errors, warningCount: warnings };
    }, [questions, mismatchCache, issuesForPair]);

    return (
        <div className="flex flex-col min-h-screen bg-white">
            {/* Top Bar */}
            <div className="flex-shrink-0 bg-white border-b border-gray-200 shadow-sm px-4 py-2 space-y-2">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-bold text-gray-900 flex-shrink-0">Review Tests in Production</h1>

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
                            <option value="">
                                {loadingPapers ? 'Loading...' : `Select Production Paper Pair (${papers.length})...`}
                            </option>
                            {papers.map(p => (
                                <option key={`${p.en_session_id}|${p.hi_session_id}`} value={`${p.en_session_id}|${p.hi_session_id}`}>
                                    {p.en_label} — {p.linked_count} linked [PRODUCTION]
                                </option>
                            ))}
                        </select>
                    )}

                    {feedback && (
                        <span className={`text-xs px-2.5 py-1 rounded font-medium flex-shrink-0 ${feedback.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                            {feedback.msg}
                        </span>
                    )}
                </div>

                {/* Stats + Filters (only when paper loaded) */}
                {selectedPair && questions.length > 0 && (
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-gray-500">
                            {bothSolvedCount}/{questions.length} both solved
                            {mismatchCount > 0 && <span className="text-red-600 ml-1">({mismatchCount} mismatches)</span>}
                            {errorCount > 0 && <span className="text-red-700 ml-1 font-semibold">⛔ {errorCount} with errors</span>}
                            {warningCount > 0 && <span className="text-amber-700 ml-1">⚠️ {warningCount} with warnings</span>}
                        </span>
                        {selectedPair?.en_pdf_path && (
                            <a href={`/api/pdf?path=${encodeURIComponent(selectedPair.en_pdf_path)}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline bg-white border border-gray-200 px-2 py-0.5 rounded">
                                EN PDF
                            </a>
                        )}
                        {selectedPair?.hi_pdf_path && (
                            <a href={`/api/pdf?path=${encodeURIComponent(selectedPair.hi_pdf_path)}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs text-orange-600 hover:underline bg-white border border-gray-200 px-2 py-0.5 rounded">
                                HI PDF
                            </a>
                        )}
                        <div className="flex gap-1">
                            {[
                                { key: 'all',         label: 'All' },
                                { key: 'both_solved', label: 'Both Solved' },
                                { key: 'unsolved',    label: 'Unsolved' },
                                { key: 'mismatch',    label: `Mismatches (${mismatchCount})` },
                                { key: 'errors',      label: `Errors (${errorCount})`,   active: 'bg-red-600 text-white' },
                                { key: 'issues',      label: `All Issues (${errorCount + warningCount})` },
                            ].map(f => (
                                <button key={f.key} onClick={() => setFilter(f.key)}
                                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${filter === f.key ? (f.active || 'bg-indigo-600 text-white') : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Body — full width, no sidebar palette */}
            <main className="flex-1 bg-gray-50">
                {!selectedExamId ? (
                    <div className="flex items-center justify-center min-h-[60vh]">
                        <div className="text-center">
                            <h2 className="text-xl font-semibold text-gray-700">Select an exam</h2>
                            <p className="text-gray-400 mt-2 text-sm">Choose an exam, then a production paper pair to review.</p>
                        </div>
                    </div>
                ) : !selectedPair ? (
                    <div className="flex items-center justify-center min-h-[60vh]">
                        <div className="text-center">
                            <h2 className="text-xl font-semibold text-gray-700">Select a production paper pair</h2>
                            <p className="text-gray-400 mt-2 text-sm">
                                {loadingPapers ? 'Loading...' : `${papers.length} EN+HI pairs currently in PRODUCTION`}
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

                        {/* Standalone Hindi (Hindi-first because the panels are HI-left).
                            Clean standalones are hidden — only rows with at least one
                            actionable issue (missing solution, blank options, no
                            correct answer, etc.) are surfaced here. */}
                        {visibleHiUnlinked.length > 0 && (
                            <div className="pt-8">
                                <div className="mb-3 flex items-center gap-3 flex-wrap">
                                    <h2 className="text-sm font-bold text-orange-800 uppercase tracking-wide">
                                        Standalone Hindi Questions
                                    </h2>
                                    <span className="text-xs text-gray-500">
                                        {visibleHiUnlinked.length} with issues / {hiUnlinked.length} unlinked
                                    </span>
                                </div>
                                <div className="space-y-4">
                                    {visibleHiUnlinked.map((row, idx) => {
                                        const pseudoPair = {
                                            link_id: `hi-only-${row.question_id}`,
                                            section_code: row.section_code,
                                            en: null,
                                            hi: row,
                                        };
                                        return (
                                            <div key={pseudoPair.link_id} id={`bp-${pseudoPair.link_id}`}>
                                                <BilingualCard pair={pseudoPair} idx={idx} onDifficultyChange={handleDifficultyChange} />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Standalone English — same rule: only show rows with issues. */}
                        {visibleEnUnlinked.length > 0 && (
                            <div className="pt-8">
                                <div className="mb-3 flex items-center gap-3 flex-wrap">
                                    <h2 className="text-sm font-bold text-blue-800 uppercase tracking-wide">
                                        Standalone English Questions
                                    </h2>
                                    <span className="text-xs text-gray-500">
                                        {visibleEnUnlinked.length} with issues / {enUnlinked.length} unlinked
                                    </span>
                                </div>
                                <div className="space-y-4">
                                    {visibleEnUnlinked.map((row, idx) => {
                                        const pseudoPair = {
                                            link_id: `en-only-${row.question_id}`,
                                            section_code: row.section_code,
                                            en: row,
                                            hi: null,
                                        };
                                        return (
                                            <div key={pseudoPair.link_id} id={`bp-${pseudoPair.link_id}`}>
                                                <BilingualCard pair={pseudoPair} idx={idx} onDifficultyChange={handleDifficultyChange} />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {loadingUnlinked && (
                            <div className="pt-6 text-center text-xs text-gray-400">
                                Loading standalone questions…
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
