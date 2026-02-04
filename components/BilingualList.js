'use client';

import { useState } from 'react';
import Latex from '@/components/Latex';
import ImageEditor from '@/components/ImageEditor';

export default function BilingualList({ initialQuestions, total, currentPage, totalPages, paperSessionId, engDocInfo, hinDocInfo }) {

    // Helper to render links
    const renderDocLink = (path, label, colorClass = "text-blue-600") => {
        if (!path) return null;
        const filename = path.split(/[/\\]/).pop();
        const url = `/api/pdf?path=${encodeURIComponent(path)}`;
        return (
            <a href={url} target="_blank" rel="noopener noreferrer" className={`${colorClass} hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded shadow-sm`} title={path}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-gray-500">
                    <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" />
                    <path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" />
                </svg>
                <span className="truncate max-w-[150px]">{label || filename}</span>
            </a>
        );
    };

    const cleanNotesEng = engDocInfo?.notes ? engDocInfo.notes.replace(/ingested from\s*/i, '').trim() : null;
    const cleanNotesHin = hinDocInfo?.notes ? hinDocInfo.notes.replace(/ingested from\s*/i, '').trim() : null;

    const [questions, setQuestions] = useState(() => {
        // Ensure every question has A, B, C, D options
        const REQUIRED_OPTS = ['A', 'B', 'C', 'D'];

        return initialQuestions.map(q => {
            const fillOptions = (existingOpts) => {
                const optMap = new Map(existingOpts.map(o => [o.opt_label, o]));
                return REQUIRED_OPTS.map(label => ({
                    opt_label: label,
                    opt_text: optMap.get(label)?.opt_text || ''
                }));
            };

            return {
                ...q,
                eng_options: fillOptions(q.eng_options || []),
                hin_options: fillOptions(q.hin_options || [])
            };
        });
    });

    const [imageEditor, setImageEditor] = useState({
        isOpen: false,
        imageDataUrl: null,
        targetQuestion: null,  // { index, lang, isOption, optIndex }
    });

    const [bulkCompleting, setBulkCompleting] = useState(false);

    // Unified Direct Upload Function
    const performUpload = async (fileBlob, index, lang, isOption, optIndex) => {
        const q = questions[index];
        const questionId = lang === 'eng' ? q.eng_id : q.hin_id;
        const language = lang === 'eng' ? 'EN' : 'HI';
        const version = lang === 'eng' ? q.eng_version : q.hin_version;
        const role = isOption ? 'option' : 'stem';
        const optionKey = isOption ? ['A', 'B', 'C', 'D'][optIndex] : '__STEM__';

        const reader = new FileReader();
        reader.readAsDataURL(fileBlob);
        reader.onloadend = async () => {
            const base64data = reader.result;
            try {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: base64data,
                        question_id: questionId,
                        language: language,
                        version_no: version,
                        role: role,
                        option_key: optionKey
                    })
                });
                const data = await res.json();
                if (data.latexPath) {
                    insertImageTag(data.latexPath, index, lang, optIndex);
                } else {
                    alert('Upload failed: ' + (data.error || 'Unknown error'));
                }
            } catch (e) {
                console.error(e);
                alert('Upload failed');
            }
        };
    };

    // Handle Ctrl+V Paste - DIRECT UPLOAD
    const handlePaste = (e, index, lang, optIndex = null) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (let item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                // Bypass Editor: Directly upload
                performUpload(blob, index, lang, optIndex !== null, optIndex);
                break;
            }
        }
    };

    const handleImageEditorSave = async (croppedBlob) => {
        if (!imageEditor.targetQuestion) return;
        const { index, lang, isOption, optIndex } = imageEditor.targetQuestion;
        await performUpload(croppedBlob, index, lang, isOption, optIndex);
        setImageEditor({ isOpen: false, imageDataUrl: null, targetQuestion: null });
    };

    const insertImageTag = (path, index, lang, optIndex = null) => {
        const imageTag = `\\includegraphics{${path}}`;
        const newQs = [...questions];
        const targetQ = newQs[index];

        if (lang === 'eng') {
            if (optIndex !== null) {
                targetQ.eng_options[optIndex].opt_text += ` ${imageTag}`;
            } else {
                targetQ.eng_text += `\n\n${imageTag}`;
            }
        } else {
            if (optIndex !== null) {
                targetQ.hin_options[optIndex].opt_text += ` ${imageTag}`;
            } else {
                targetQ.hin_text += `\n\n${imageTag}`;
            }
        }
        setQuestions(newQs);
    };

    const handleImageUpload = async (file, index, lang, optIndex = null) => {
        // Bypass Editor: Directly upload from file input
        performUpload(file, index, lang, optIndex !== null, optIndex);
    };

    const handleSave = async (index, status = 'MANUALLY_CORRECTED') => {
        const q = questions[index];

        try {
            const res = await fetch('/api/bilingual/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    link_id: q.link_id,
                    status: status,
                    english: {
                        id: q.eng_id,
                        version: q.eng_version,
                        question_text: q.eng_text,
                        options: q.eng_options
                    },
                    hindi: {
                        id: q.hin_id,
                        version: q.hin_version,
                        question_text: q.hin_text,
                        options: q.hin_options
                    }
                })
            });

            if (res.ok) {
                const newQs = [...questions];
                // Set status and transient feedback message
                newQs[index] = {
                    ...q,
                    status: status,
                    updated_score: 1.0,
                    feedbackMessage: status === 'FLAGGED' ? 'Marked for Review!' : 'Saved!'
                };
                setQuestions(newQs);

                // Clear feedback after 1.5 seconds
                setTimeout(() => {
                    setQuestions(currentQs => {
                        const qs = [...currentQs];
                        if (qs[index]) {
                            qs[index] = { ...qs[index], feedbackMessage: null };
                        }
                        return qs;
                    });
                }, 1500);
                const errorData = await res.json();
                alert(`Failed to save.\n\nError: ${errorData.details || errorData.error}\n\n${errorData.stack || ''}`);
            }
        } catch (e) {
            console.error(e);
            alert('Error saving.');
        }
    };

    const handleTextChange = (index, lang, field, value, optIndex = null) => {
        const newQs = [...questions];
        const targetQ = newQs[index];

        if (lang === 'eng') {
            if (optIndex !== null) {
                targetQ.eng_options[optIndex].opt_text = value;
            } else {
                targetQ.eng_text = value;
            }
        } else {
            if (optIndex !== null) {
                targetQ.hin_options[optIndex].opt_text = value;
            } else {
                targetQ.hin_text = value;
            }
        }
        setQuestions(newQs);
    };

    const handleTranslate = async (index, sourceLang) => {
        const newQs = [...questions];
        if (sourceLang === 'en') {
            newQs[index].isTranslatingEng = true;
        } else {
            newQs[index].isTranslatingHin = true;
        }
        setQuestions(newQs);

        const q = questions[index];
        const textToTranslate = sourceLang === 'en' ? q.eng_text : q.hin_text;
        const targetLang = sourceLang === 'en' ? 'hi' : 'en';

        if (!textToTranslate) {
            newQs[index].isTranslatingEng = false;
            newQs[index].isTranslatingHin = false;
            setQuestions([...newQs]);
            return;
        }

        try {
            const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: textToTranslate, source: sourceLang, target: targetLang })
            });
            const data = await res.json();

            const updatedQs = [...questions];
            if (sourceLang === 'en') {
                updatedQs[index].isTranslatingEng = false;
                if (data.translatedText) updatedQs[index].eng_translation = data.translatedText;
            } else {
                updatedQs[index].isTranslatingHin = false;
                if (data.translatedText) updatedQs[index].hin_translation = data.translatedText;
            }
            setQuestions(updatedQs);

        } catch (e) {
            alert('Translation failed');
            const updatedQs = [...questions];
            if (sourceLang === 'en') updatedQs[index].isTranslatingEng = false;
            else updatedQs[index].isTranslatingHin = false;
            setQuestions(updatedQs);
        }
    };

    const handleBulkComplete = async () => {
        const confirmMsg = `This will mark ALL ${total} question pairs in both English and Hindi papers as "Manually Corrected".

This action will:
- Set status to MANUALLY_CORRECTED for all questions
- Set updated_score to 1.0 for all questions
- Mark both paper sessions as reviewed

Are you sure you want to proceed?`;

        if (!confirm(confirmMsg)) {
            return;
        }

        setBulkCompleting(true);

        try {
            const res = await fetch('/api/bilingual/bulk-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paper_session_id: paperSessionId })
            });

            const data = await res.json();

            if (res.ok) {
                alert(`✅ Success! Updated ${data.updatedCount} question pairs.\n\nBoth paper sessions have been marked as reviewed.\n\nRefreshing page...`);
                window.location.reload();
            } else {
                alert(`❌ Error: ${data.error}\n\n${data.details || ''}`);
                setBulkCompleting(false);
            }
        } catch (e) {
            console.error(e);
            alert('❌ Error completing bulk update. Please try again.');
            setBulkCompleting(false);
        }
    };

    const formatText = (text) => {
        if (!text) return text;

        // Keywords that should have double line break before them
        const keywords = [
            '(Note:',
            'Note:',
            'नोट:',
            '(नोट:',
            'Statement:',
            'Statements:',
            'Conclusion:',
            'Conclusions:',
            'कथन:',
            'निष्कर्ष:'
        ];

        let formatted = text;

        // For each keyword, add double line break before it if not already present
        keywords.forEach(keyword => {
            // Look for instances of the keyword
            let index = formatted.indexOf(keyword);

            while (index !== -1) {
                // Check what comes before the keyword
                const before = formatted.substring(Math.max(0, index - 2), index);

                if (before !== '\n\n') {
                    // Need to add line breaks
                    if (before.endsWith('\n')) {
                        // Already has one newline, add one more
                        formatted = formatted.substring(0, index) + '\n' + formatted.substring(index);
                        index++; // Adjust index for the added character
                    } else if (index > 0) {
                        // No newlines, add two
                        formatted = formatted.substring(0, index) + '\n\n' + formatted.substring(index);
                        index += 2; // Adjust index for the added characters
                    }
                }

                // Find next occurrence
                index = formatted.indexOf(keyword, index + keyword.length);
            }
        });

        return formatted;
    };

    const formatSentences = (text, lang) => {
        if (!text) return text;

        // Determine sentence ending based on language
        const sentenceEnd = lang === 'eng' ? '.' : '।';

        let formatted = text;
        let index = formatted.indexOf(sentenceEnd);

        while (index !== -1) {
            // Check if there's content after the sentence ending
            const afterIndex = index + sentenceEnd.length;

            if (afterIndex < formatted.length) {
                // Check what comes after the sentence ending
                const after = formatted.substring(afterIndex, Math.min(afterIndex + 2, formatted.length));

                // Only add line breaks if not already present
                if (after !== '\n\n') {
                    // Check if there's already one newline
                    if (!after.startsWith('\n')) {
                        // No newline, add two
                        formatted = formatted.substring(0, afterIndex) + '\n\n' + formatted.substring(afterIndex);
                        index = afterIndex + 2; // Move past the added newlines
                    } else if (after.length >= 2 && after[1] !== '\n') {
                        // Has one newline, add one more
                        formatted = formatted.substring(0, afterIndex + 1) + '\n' + formatted.substring(afterIndex + 1);
                        index = afterIndex + 2; // Move past the added newline
                    } else {
                        // Already has double newline
                        index = afterIndex;
                    }
                }
            }

            // Find next sentence ending
            index = formatted.indexOf(sentenceEnd, index + 1);
        }

        return formatted;
    };

    const handleFormatQuestion = (index, lang) => {
        const newQs = [...questions];
        const targetQ = newQs[index];

        if (lang === 'eng') {
            targetQ.eng_text = formatSentences(targetQ.eng_text, 'eng');
        } else {
            targetQ.hin_text = formatSentences(targetQ.hin_text, 'hin');
        }

        setQuestions(newQs);

    };

    const handleFormatAll = () => {
        const confirmMsg = `This will format ALL ${questions.length} question pairs on this page by adding line spacing before keywords like Note, Statement, Conclusion, etc.\n\nYou will need to save each question manually.\n\nContinue?`;

        if (!confirm(confirmMsg)) {
            return;
        }

        const newQs = questions.map(q => ({
            ...q,
            eng_text: formatText(q.eng_text),
            hin_text: formatText(q.hin_text)
        }));

        setQuestions(newQs);
        alert('✅ Formatted all questions! Remember to save each question individually.');
    };

    const handleUnderline = (index, lang, isOption = false, optIndex = null) => {
        // Get the textarea element
        const textareaId = isOption
            ? `${lang}-opt-${index}-${optIndex}`
            : `${lang}-text-${index}`;
        const textarea = document.getElementById(textareaId);

        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end);

        if (!selectedText) {
            alert('Please select some text first');
            return;
        }

        // Wrap selected text with underline syntax
        const wrappedText = `$\\underline{\\text{${selectedText}}}$`;
        const newValue = textarea.value.substring(0, start) + wrappedText + textarea.value.substring(end);

        // Update the state
        handleTextChange(index, lang, isOption ? 'opt' : 'text', newValue, optIndex);

        // Set cursor position after the inserted text
        setTimeout(() => {
            textarea.focus();
            const newCursorPos = start + wrappedText.length;
            textarea.setSelectionRange(newCursorPos, newCursorPos);
        }, 0);
    };

    const handleFixLatex = async (index, lang) => {
        const newQs = [...questions];
        const targetQ = newQs[index];
        const textToFix = lang === 'eng' ? targetQ.eng_text : targetQ.hin_text;

        if (!textToFix) {
            alert('No text to fix');
            return;
        }

        try {
            const res = await fetch('/api/bilingual/fix-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: textToFix })
            });

            const data = await res.json();

            if (res.ok && data.fixedText) {
                if (lang === 'eng') {
                    targetQ.eng_text = data.fixedText;
                } else {
                    targetQ.hin_text = data.fixedText;
                }
                setQuestions(newQs);

                if (data.fixedText === textToFix) {
                    alert('✅ No LaTeX errors found!');
                } else {
                    alert('✅ LaTeX syntax fixed!');
                }
            } else {
                alert('❌ Error: ' + (data.error || 'Failed to fix LaTeX'));
            }
        } catch (e) {
            console.error(e);
            alert('❌ Error fixing LaTeX: ' + e.message);
        }
    };

    const handleCopyOptions = (index, direction = 'eng-to-hin') => {
        const newQs = [...questions];
        const targetQ = newQs[index];

        if (direction === 'eng-to-hin') {
            // Copy English -> Hindi
            if (targetQ.eng_options && targetQ.eng_options.length > 0) {
                targetQ.hin_options = targetQ.eng_options.map(opt => ({
                    ...opt,
                    opt_id: null // Reset ID
                }));
                setQuestions(newQs);
                // alert('✅ Copied options from English to Hindi!');
            } else {
                alert('❌ No English options to copy');
            }
        } else {
            // Copy Hindi -> English
            if (targetQ.hin_options && targetQ.hin_options.length > 0) {
                targetQ.eng_options = targetQ.hin_options.map(opt => ({
                    ...opt,
                    opt_id: null // Reset ID
                }));
                setQuestions(newQs);
                // alert('✅ Copied options from Hindi to English!');
            } else {
                alert('❌ No Hindi options to copy');
            }
        }
    };

    return (
        <div className="container mx-auto px-4 py-8">
            <ImageEditor
                isOpen={imageEditor.isOpen}
                imageDataUrl={imageEditor.imageDataUrl}
                onSave={handleImageEditorSave}
                onCancel={() => setImageEditor({ ...imageEditor, isOpen: false })}
            />

            <header className="mb-8">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 mb-2">Bilingual Review Dashboard</h1>
                        <p className="text-gray-500">Session ID: {paperSessionId}</p>
                    </div>

                    <div className="flex gap-3 items-center">
                        <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-md px-2 py-1 shadow-sm">
                            <span className="text-xs font-semibold text-gray-500 uppercase">Sort By:</span>
                            <select
                                value={new URLSearchParams(window.location.search).get('sort') || 'eng'}
                                onChange={(e) => {
                                    const params = new URLSearchParams(window.location.search);
                                    params.set('sort', e.target.value);
                                    window.location.search = params.toString();
                                }}
                                className="text-sm border-none focus:ring-0 text-gray-700 font-medium bg-transparent cursor-pointer"
                            >
                                <option value="eng">English Order</option>
                                <option value="hin">Hindi Order</option>
                            </select>
                        </div>
                        <button
                            onClick={handleFormatAll}
                            className="px-4 py-2 rounded-lg font-bold text-sm uppercase tracking-wide transition-all shadow-md bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white"
                            title="Format all questions by adding line spacing before Note, Statement, Conclusion keywords"
                        >
                            📝 Format All
                        </button>

                        {/* Complete Review Button Removed from here */}
                    </div>
                </div>

                <div className="flex flex-wrap gap-4 mt-2 text-xs items-center">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-400 uppercase text-[10px]">English:</span>
                        {renderDocLink(engDocInfo?.source_pdf_path, "Source PDF", "text-blue-600")}
                    </div>

                    {(hinDocInfo?.source_pdf_path) && (
                        <div className="flex items-center gap-2 border-l pl-4 ml-2 border-gray-300">
                            <span className="font-bold text-gray-400 uppercase text-[10px]">Hindi:</span>
                            {renderDocLink(hinDocInfo?.source_pdf_path, "Source PDF", "text-orange-600")}
                        </div>
                    )}
                </div>

                <p className="text-sm text-gray-400 mt-2">Found {total} linked pairs (Page {currentPage} of {totalPages})</p>
            </header>

            <div className="flex gap-6 relative">
                {/* Navigation Sidebar */}
                <aside className="hidden lg:block w-64 shrink-0 h-[calc(100vh-8rem)] sticky top-4 overflow-y-auto pr-2 custom-scrollbar">
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                        <h3 className="text-xs font-bold text-gray-500 uppercase mb-4 sticky top-0 bg-white z-10 py-1">Questions</h3>
                        <div className="grid grid-cols-4 gap-2">
                            {questions.map((q, idx) => {
                                const isUnlinked = !q.link_id;
                                const isCorrected = q.status === 'MANUALLY_CORRECTED';
                                const isFlagged = q.status === 'FLAGGED';
                                const qNum = q.eng_source_no || (idx + 1);

                                let bgClass = "bg-gray-100 text-gray-600 hover:bg-gray-200";
                                if (isUnlinked) bgClass = "bg-red-900 text-white font-bold border border-red-950";
                                else if (isFlagged) bgClass = "bg-orange-100 text-orange-700 border border-orange-200";
                                else if (isCorrected) bgClass = "bg-green-100 text-green-700 border border-green-200";

                                return (
                                    <a
                                        key={idx}
                                        href={`#question-${q.eng_id}`}
                                        className={`text-[10px] font-bold py-1.5 rounded transition-colors text-center ${bgClass}`}
                                        title={isUnlinked ? "Unlinked / Missing Translation" : `Status: ${q.status}`}
                                    >
                                        {qNum}
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                </aside>

                <div className="flex-1 space-y-12 mb-12 min-w-0">
                    {questions.map((q, index) => {
                        const isLowScore = q.updated_score != null && q.updated_score < 0.8;
                        const isCorrected = q.status === 'MANUALLY_CORRECTED';
                        const isUnlinked = !q.link_id;

                        // VALIDATION LOGIC
                        const warnings = [];
                        const errors = [];

                        // Helper to detect images
                        const hasImage = (text) => /\\includegraphics|!\[.*?\]\(.*?\)/.test(text || '');

                        // 0. English Section Detection (Heuristic: First 10 chars are identical)
                        // If start of English text matches start of Hindi text, we assume it's an English Language Section
                        const isEnglishSection = q.eng_text && q.hin_text && q.eng_text.substring(0, 10).toLowerCase() === q.hin_text.substring(0, 10).toLowerCase();

                        // 1. Image Mismatch
                        const engHasImg = hasImage(q.eng_text) || q.eng_options.some(o => hasImage(o.opt_text));
                        const hinHasImg = hasImage(q.hin_text) || q.hin_options.some(o => hasImage(o.opt_text));

                        if (engHasImg !== hinHasImg) {
                            errors.push(`Image Mismatch: ${engHasImg ? 'English' : 'Hindi'} has images, but ${engHasImg ? 'Hindi' : 'English'} does not.`);
                        }

                        // 2. Option Count & Empty Check
                        const emptyEngOpts = q.eng_options.some(o => !o.opt_text || !o.opt_text.trim());
                        const emptyHinOpts = q.hin_options.some(o => !o.opt_text || !o.opt_text.trim());

                        if (q.eng_options.length < 4 || emptyEngOpts) {
                            errors.push("English options are incomplete or blank (less than 4).");
                        }
                        if (q.hin_options.length < 4 || emptyHinOpts) {
                            errors.push("Hindi options are incomplete or blank (less than 4).");
                        }

                        if (isEnglishSection) {
                            // --- ENGLISH SECTION RULES ---

                            // Rule A: Duplicate Content Check (English MUST == Hindi)
                            if (q.eng_text !== q.hin_text) {
                                errors.push("English Section: English and Hindi text must be identical.");
                            }

                            q.eng_options.forEach((engOpt, i) => {
                                // SKIP strict positional check
                            });

                            // Rule A.2: Set-based Equality Check for Options
                            // Get all option texts, trim, and sort
                            const engOptTexts = q.eng_options.map(o => (o.opt_text || '').trim()).sort();
                            const hinOptTexts = q.hin_options.map(o => (o.opt_text || '').trim()).sort();

                            // Compare arrays
                            const optionsMatch = engOptTexts.length === hinOptTexts.length &&
                                engOptTexts.every((val, index) => val === hinOptTexts[index]);

                            if (!optionsMatch) {
                                errors.push("English Section: Option sets do not match between English and Hindi.");
                            }

                            // Rule B: Flag "underlined" keyword
                            if (/underlined/i.test(q.eng_text)) {
                                errors.push("English Section: Question contains 'underlined' keyword.");
                            }

                            // Rule C: Disable 15-char limit check (Do nothing here, just don't run the check below)

                        } else {
                            // --- STANDARD SECTION RULES ---

                            // 3. Option Length Check (> 15 chars)
                            const longEngOpts = q.eng_options.some(o => o.opt_text && o.opt_text.length > 15 && !hasImage(o.opt_text));
                            const longHinOpts = q.hin_options.some(o => o.opt_text && o.opt_text.length > 15 && !hasImage(o.opt_text));

                            if (longEngOpts) warnings.push("English options are long (>15 chars). verify if they should be images.");
                            if (longHinOpts) warnings.push("Hindi options are long (>15 chars). verify if they should be images.");
                        }

                        const hasErrors = errors.length > 0;
                        const hasWarnings = warnings.length > 0;

                        let borderClass = 'border-gray-200';
                        let bgClass = 'bg-white';

                        if (hasErrors) {
                            borderClass = 'border-red-500 ring-2 ring-red-100';
                            bgClass = 'bg-red-50';
                        } else if (isUnlinked) {
                            borderClass = 'border-red-900 border-2 bg-red-50';
                            bgClass = 'bg-red-50';
                        } else if (hasWarnings) {
                            borderClass = 'border-pink-400 ring-2 ring-pink-50';
                            bgClass = 'bg-pink-50';
                        } else if (isLowScore && !isCorrected) {
                            borderClass = 'border-red-500 bg-red-50 ring-2 ring-red-200';
                        }

                        return (
                            <div id={`question-${q.eng_id}`} key={q.link_id} className={`rounded-lg shadow-sm border overflow-hidden ${borderClass} ${bgClass} transition-all duration-200`}>
                                {/* Validation Messages */}
                                {(hasErrors || hasWarnings) && (
                                    <div className={`px-6 py-2 text-xs font-bold ${hasErrors ? 'bg-red-100 text-red-800' : 'bg-pink-100 text-pink-800'} border-b ${hasErrors ? 'border-red-200' : 'border-pink-200'}`}>
                                        {errors.map((e, i) => <div key={`err-${i}`} className="flex items-center gap-2">❌ {e}</div>)}
                                        {warnings.map((w, i) => <div key={`warn-${i}`} className="flex items-center gap-2">⚠️ {w}</div>)}
                                    </div>
                                )}

                                {isUnlinked && (
                                    <div className="bg-red-900 text-white text-xs font-bold px-4 py-2 flex justify-between items-center">
                                        <span>🚫 Unlinked Question (Missing Translation Partner)</span>
                                    </div>
                                )}

                                {isLowScore && !isCorrected && !hasErrors && !isUnlinked && (
                                    <div className="bg-red-600 text-white text-xs font-bold px-4 py-1 flex justify-between items-center">
                                        <span>⚠️ Low Confidence Match</span>
                                        <span>Score: {Number(q.updated_score).toFixed(3)}</span>
                                    </div>
                                )}
                                <div className={`px-6 py-3 border-b flex justify-between items-center text-sm ${isLowScore && !isCorrected ? 'bg-red-100 border-red-200' : 'bg-gray-50/50 border-gray-200'}`}>
                                    <div className="font-mono text-gray-500">
                                        Q.{q.eng_source_no || q.eng_id.substring(0, 6)} {/* Showing Question Number/ID as title instead of Link ID */}
                                    </div>
                                    <div className="flex gap-2 items-center">
                                        {/* Feedback Message */}
                                        {q.feedbackMessage && (
                                            <span className="animate-fade-in-out font-bold text-green-600 bg-green-50 px-2 py-1 rounded text-xs border border-green-200 mr-2 shadow-sm">
                                                ✅ {q.feedbackMessage}
                                            </span>
                                        )}
                                        <span className={`px-2 py-0.5 rounded text-xs font-semibold mr-2 ${q.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' : q.status === 'FLAGGED' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                                            {q.status}
                                        </span>

                                        <button
                                            onClick={() => handleSave(index, 'FLAGGED')}
                                            className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors shadow-sm"
                                            title="Mark question for further review"
                                        >
                                            Mark for Review
                                        </button>
                                        <button
                                            onClick={() => handleSave(index, 'MANUALLY_CORRECTED')}
                                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors shadow-sm"
                                        >
                                            Save Changes
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
                                    {/* English Column */}
                                    <div className="p-6">
                                        <div className="flex justify-between items-center mb-4">
                                            <span className="inline-block bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded">ENGLISH</span>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleFixLatex(index, 'eng')}
                                                    className="px-2 py-1 text-xs font-bold bg-rose-500 text-white rounded hover:bg-rose-600 shadow-sm"
                                                    title="Fix LaTeX syntax errors"
                                                >
                                                    FL
                                                </button>
                                                <button
                                                    onClick={() => handleUnderline(index, 'eng')}
                                                    className="px-2 py-1 text-xs font-bold bg-blue-500 text-white rounded hover:bg-blue-600 shadow-sm"
                                                    title="Underline selected text"
                                                >
                                                    U
                                                </button>
                                                <button
                                                    onClick={() => handleFormatQuestion(index, 'eng')}
                                                    className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded hover:bg-blue-100 font-medium"
                                                    title="Add line spacing after each sentence (after .)"
                                                >
                                                    📝 Format
                                                </button>
                                                <button
                                                    onClick={() => handleTranslate(index, 'en')}
                                                    disabled={q.isTranslatingEng}
                                                    className={`text-xs font-medium text-purple-600 bg-purple-50 border border-purple-200 px-2 py-1 rounded hover:bg-purple-100 transition-colors ${q.isTranslatingEng ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    title="Generate Hindi Translation"
                                                >
                                                    {q.isTranslatingEng ? '...' : '🌐 Translate'}
                                                </button>
                                            </div>
                                        </div>

                                        <div className="mb-6">
                                            <h3 className="text-sm font-bold text-gray-700 mb-2">Q.{q.eng_source_no || q.eng_id.substring(0, 6)}</h3>
                                            <div className="relative">
                                                <textarea
                                                    id={`eng-text-${index}`}
                                                    className="w-full p-3 border border-gray-300 rounded font-mono text-sm min-h-[150px] mb-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                    value={q.eng_text}
                                                    onChange={(e) => handleTextChange(index, 'eng', 'text', e.target.value)}
                                                    onPaste={(e) => handlePaste(e, index, 'eng')}
                                                    onKeyDown={(e) => {
                                                        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                                                            e.preventDefault();
                                                            handleSave(index, 'MANUALLY_CORRECTED');
                                                        }
                                                    }}
                                                    placeholder="Paste image here (Ctrl+V)..."
                                                />
                                            </div>


                                            {q.eng_translation && (
                                                <div className="mb-2 p-3 bg-blue-50/30 border border-blue-100 rounded text-sm text-gray-800 relative group">
                                                    <p className="text-[10px] font-bold text-blue-400 uppercase mb-1">Hindi Translation</p>
                                                    <Latex>{q.eng_translation}</Latex>
                                                </div>
                                            )}

                                            <div className="p-3 bg-gray-50 rounded border border-gray-200 text-sm">
                                                <p className="text-xs font-bold text-gray-400 uppercase mb-1">Preview</p>
                                                <Latex>{q.eng_text}</Latex>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            {q.eng_options.map((opt, optIdx) => (
                                                <div key={opt.opt_label} className="p-2 border border-gray-100 rounded bg-gray-50/50">
                                                    <div className="flex gap-2 items-center mb-2">
                                                        <div className="w-6 h-6 flex items-center justify-center rounded-full bg-white border border-gray-300 text-xs font-bold text-gray-500 shrink-0">
                                                            {opt.opt_label}
                                                        </div>
                                                        <input
                                                            className="flex-1 text-xs p-1 border border-gray-300 rounded font-mono"
                                                            value={opt.opt_text}
                                                            onChange={(e) => handleTextChange(index, 'eng', 'opt', e.target.value, optIdx)}
                                                            onPaste={(e) => handlePaste(e, index, 'eng', optIdx)}
                                                            onKeyDown={(e) => {
                                                                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                                                                    e.preventDefault();
                                                                    handleSave(index, 'MANUALLY_CORRECTED');
                                                                }
                                                            }}
                                                        />
                                                        <label className="cursor-pointer text-gray-400 hover:text-blue-600 p-1" title="Add Image to Option">
                                                            ➕
                                                            <input type="file" className="hidden" onChange={(e) => e.target.files[0] && handleImageUpload(e.target.files[0], index, 'eng', optIdx)} />
                                                        </label>
                                                    </div>
                                                    <div className="pl-8 text-xs text-gray-700">
                                                        <Latex>{opt.opt_text}</Latex>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Hindi Column */}
                                    <div className="p-6 bg-orange-50/10">
                                        <div className="flex justify-between items-center mb-4">
                                            <span className="inline-block bg-orange-100 text-orange-800 text-xs font-bold px-2 py-1 rounded">HINDI</span>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleFixLatex(index, 'hin')}
                                                    className="px-2 py-1 text-xs font-bold bg-rose-500 text-white rounded hover:bg-rose-600 shadow-sm"
                                                    title="Fix LaTeX syntax errors"
                                                >
                                                    FL
                                                </button>
                                                <button
                                                    onClick={() => handleUnderline(index, 'hin')}
                                                    className="px-2 py-1 text-xs font-bold bg-orange-500 text-white rounded hover:bg-orange-600 shadow-sm"
                                                    title="Underline selected text"
                                                >
                                                    U
                                                </button>
                                                <button
                                                    onClick={() => handleFormatQuestion(index, 'hin')}
                                                    className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-2 py-1 rounded hover:bg-orange-100 font-medium"
                                                    title="Add line spacing after each sentence (after ।)"
                                                >
                                                    📝 Format
                                                </button>
                                                <button
                                                    onClick={() => handleTranslate(index, 'hi')}
                                                    disabled={q.isTranslatingHin}
                                                    className={`text-xs font-medium text-purple-600 bg-purple-50 border border-purple-200 px-2 py-1 rounded hover:bg-purple-100 transition-colors ${q.isTranslatingHin ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    title="Generate English Translation"
                                                >
                                                    {q.isTranslatingHin ? '...' : '🌐 Translate'}
                                                </button>
                                            </div>
                                        </div>

                                        <div className="mb-6">
                                            <h3 className="text-sm font-bold text-gray-700 mb-2">Q.{q.hin_source_no || q.hin_id.substring(0, 6)}</h3>
                                            <div className="relative">
                                                <textarea
                                                    id={`hin-text-${index}`}
                                                    className="w-full p-3 border border-gray-300 rounded font-mono text-sm min-h-[150px] mb-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                                                    value={q.hin_text}
                                                    onChange={(e) => handleTextChange(index, 'hin', 'text', e.target.value)}
                                                    onPaste={(e) => handlePaste(e, index, 'hin')}
                                                    onKeyDown={(e) => {
                                                        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                                                            e.preventDefault();
                                                            handleSave(index, 'MANUALLY_CORRECTED');
                                                        }
                                                    }}
                                                    placeholder="Paste image here..."
                                                />
                                            </div>


                                            {q.hin_translation && (
                                                <div className="mb-2 p-3 bg-orange-50/30 border border-orange-100 rounded text-sm text-gray-800 relative group">
                                                    <p className="text-[10px] font-bold text-orange-400 uppercase mb-1">English Translation</p>
                                                    <Latex>{q.hin_translation}</Latex>
                                                </div>
                                            )}

                                            <div className="p-3 bg-white rounded border border-gray-200 text-sm">
                                                <p className="text-xs font-bold text-gray-400 uppercase mb-1">Preview</p>
                                                <Latex>{q.hin_text}</Latex>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            {q.hin_options.map((opt, optIdx) => (
                                                <div key={opt.opt_label} className="p-2 border border-gray-100 rounded bg-white">
                                                    <div className="flex gap-2 items-center mb-2">
                                                        <div className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 border border-gray-300 text-xs font-bold text-gray-500 shrink-0">
                                                            {opt.opt_label}
                                                        </div>
                                                        <input
                                                            className="flex-1 text-xs p-1 border border-gray-300 rounded font-mono"
                                                            value={opt.opt_text}
                                                            onChange={(e) => handleTextChange(index, 'hin', 'opt', e.target.value, optIdx)}
                                                            onPaste={(e) => handlePaste(e, index, 'hin', optIdx)}
                                                            onKeyDown={(e) => {
                                                                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                                                                    e.preventDefault();
                                                                    handleSave(index, 'MANUALLY_CORRECTED');
                                                                }
                                                            }}
                                                        />
                                                        <label className="cursor-pointer text-gray-400 hover:text-orange-600 p-1" title="Add Image to Option">
                                                            ➕
                                                            <input type="file" className="hidden" onChange={(e) => e.target.files[0] && handleImageUpload(e.target.files[0], index, 'hin', optIdx)} />
                                                        </label>
                                                    </div>
                                                    <div className="pl-8 text-xs text-gray-700">
                                                        <Latex>{opt.opt_text}</Latex>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Copy Options Buttons */}
                                <div className="flex items-center justify-between px-12 py-4 border-t border-gray-200 bg-gray-50">
                                    <button
                                        onClick={() => handleCopyOptions(index, 'eng-to-hin')}
                                        className="px-4 py-2 bg-white border border-blue-200 text-blue-700 font-bold rounded-lg hover:bg-blue-50 hover:border-blue-300 shadow-sm transition-all flex items-center gap-2"
                                        title="Copy English options to Hindi"
                                    >
                                        <span>Copy Eng to Hindi</span>
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                                        </svg>
                                    </button>

                                    <button
                                        onClick={() => handleCopyOptions(index, 'hin-to-eng')}
                                        className="px-4 py-2 bg-white border border-orange-200 text-orange-700 font-bold rounded-lg hover:bg-orange-50 hover:border-orange-300 shadow-sm transition-all flex items-center gap-2"
                                        title="Copy Hindi options to English"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                                        </svg>
                                        <span>Copy Hindi to Eng</span>
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    {questions.length === 0 && (
                        <div className="text-center py-20 bg-gray-50 rounded border border-gray-200 text-gray-500">
                            No linked questions found for this session.
                        </div>
                    )}
                </div>

                <div className="flex justify-end mb-8 px-4">
                    <button
                        onClick={handleBulkComplete}
                        disabled={bulkCompleting}
                        className={`px-6 py-3 rounded-lg font-bold text-sm uppercase tracking-wide transition-all shadow-lg ${bulkCompleting
                            ? 'bg-gray-400 cursor-not-allowed'
                            : 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white'
                            }`}
                        title="Mark all questions in both papers as manually corrected"
                    >
                        {bulkCompleting ? (
                            <span className="flex items-center gap-2">
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Processing...
                            </span>
                        ) : (
                            <span className="flex items-center gap-2">
                                ✅ Complete Review
                            </span>
                        )}
                    </button>
                </div>
                {/* Pagination Bottom */}
                {
                    totalPages > 1 && (
                        <div className="flex justify-center gap-2 mb-12">
                            {currentPage > 1 && (
                                <a href={`/bilingual/${paperSessionId}?page=${currentPage - 1}`} className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200 text-sm font-medium">
                                    Previous
                                </a>
                            )}
                            <span className="px-4 py-2 text-gray-600 text-sm">
                                Page {currentPage} of {totalPages}
                            </span>
                            {currentPage < totalPages && (
                                <a href={`/bilingual/${paperSessionId}?page=${currentPage + 1}`} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium">
                                    Next
                                </a>
                            )}
                        </div>
                    )
                }
            </div>
        </div>
        </div >
    );
}
