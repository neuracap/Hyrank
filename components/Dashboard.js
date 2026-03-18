'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Latex from './Latex';
import QuestionCard from './QuestionCard';
import ImageEditor from './ImageEditor';

export default function Dashboard({ questions, total, tests, selectedTestId, sections, docInfo, locked, isAdmin }) {
    const searchParams = useSearchParams();
    const initialMode = searchParams.get('mode');

    const [activeTab, setActiveTab] = useState(initialMode === 'solution' ? 'solution-checker' : 'test-paper');
    const [processingSection, setProcessingSection] = useState(null);
    const [imageEditor, setImageEditor] = useState({
        isOpen: false,
        imageDataUrl: null,
        targetQuestion: null
    });
    const router = useRouter();

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

    const handleSaveQuestion = async (updatedQuestion) => {
        // Handle delete
        if (updatedQuestion.isDeleted) {
            try {
                const res = await fetch('/api/question/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: updatedQuestion.id, version_no: updatedQuestion.version_no, language: updatedQuestion.language })
                });
                if (res.ok) router.refresh();
                else alert('Delete failed');
            } catch (e) { alert('Error deleting'); }
            return;
        }

        try {
            const res = await fetch('/api/question/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: updatedQuestion.id,
                    version_no: updatedQuestion.version_no,
                    language: updatedQuestion.language,
                    question_text: updatedQuestion.question_text,
                    options: updatedQuestion.options,
                    source_question_no: updatedQuestion.source_q_no,
                    status: updatedQuestion.saveStatus || 'MANUALLY_CORRECTED'
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Save failed');
            }
        } catch (error) {
            console.error('Error saving question:', error);
            throw error;
        }
    };

    // Unified Direct Upload Logic
    const performUpload = async (blob, q, onInsert) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            const base64data = reader.result;
            try {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: base64data,
                        question_id: q.id,
                        language: q.language === 'HI' ? 'HI' : 'EN',
                        version_no: q.version_no || 1,
                        role: 'stem',
                        option_key: '__STEM__'
                    })
                });
                const data = await res.json();
                if (data.latexPath) {
                    const imageTag = `\\includegraphics{${data.latexPath}}`;
                    if (onInsert) {
                        onInsert(imageTag);
                    }
                } else {
                    console.error("Upload failed response:", data);
                    alert('Upload failed: ' + (data.error || 'Server returned success but no path'));
                }
            } catch (e) {
                console.error(e);
                alert('Error uploading image: ' + e.message);
            }
        };
    };

    const handleImagePaste = (blob, targetQuestion, optIndex, onInsert) => {
        // Bypass Editor: Direct Upload, auto-insert via callback
        performUpload(blob, targetQuestion, onInsert);
    };

    const handleAddImage = (targetQuestion) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                handleImagePaste(e.target.files[0], targetQuestion);
            }
        };
        input.click();
    };

    const handleImageEditorSave = async (croppedBlob) => {
        if (!imageEditor.targetQuestion) return;
        await performUpload(croppedBlob, imageEditor.targetQuestion);
        setImageEditor({ isOpen: false, imageDataUrl: null, targetQuestion: null });
    };

    useEffect(() => {
        const mode = searchParams.get('mode');
        if (mode === 'solution') setActiveTab('solution-checker');
        else if (mode === 'test') setActiveTab('test-paper');
    }, [searchParams]);

    const handleTestChange = (e) => {
        const id = e.target.value;
        if (id) {
            router.push(`/test?testId=${id}`);
        } else {
            router.push('/test');
        }
    };

    const handleSmartReclassify = async () => {
        if (!confirm('Smart Reclassify: This will detect oversized sections and redistribute their questions into undersized/missing sections. Continue?')) return;

        setProcessingSection('__smart__');
        try {
            const res = await fetch('/api/paper/reclassify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paper_session_id: selectedTestId,
                    smart: true
                })
            });
            const data = await res.json();
            if (data.success) {
                alert(data.message + (data.targetSections ? `\nTarget sections: ${data.targetSections.join(', ')}` : ''));
                router.refresh();
            } else {
                alert('Error: ' + data.error);
            }
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            setProcessingSection(null);
        }
    };

    const handleReclassify = async (sectionTag) => {
        if (!confirm(`Are you sure you want to reclassify questions in "${sectionTag}"? This will use AI to analyze them.`)) return;

        setProcessingSection(sectionTag);
        try {
            const res = await fetch('/api/paper/reclassify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paper_session_id: selectedTestId,
                    source_section: sectionTag
                })
            });
            const data = await res.json();
            if (data.success) {
                alert(data.message);
                router.refresh();
            } else {
                alert('Error: ' + data.error);
            }
        } catch (err) {
            alert('Error triggering reclassification');
            console.error(err);
        } finally {
            setProcessingSection(null);
        }
    };

    const handleSectionChange = async (questionId, newSectionId, newSectionName) => {
        try {
            const res = await fetch('/api/question/update-section', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: questionId,
                    section_id: newSectionId,
                    section_name: newSectionName,
                    paper_session_id: selectedTestId
                })
            });

            if (res.ok) {
                router.refresh();
            } else {
                const d = await res.json();
                alert('Failed to update section: ' + d.error);
            }
        } catch (err) {
            console.error(err);
            alert('Failed to update section');
        }
    };

    const [processingClean, setProcessingClean] = useState(false);
    const [processingImageClean, setProcessingImageClean] = useState(false);

    const handleAutoClean = async () => {
        if (!selectedTestId) return;
        if (!confirm('Auto-clean all questions in this session? This will remove promotional text and artifacts.')) return;

        setProcessingClean(true);
        try {
            const res = await fetch('/api/paper/clean', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paper_session_id: selectedTestId })
            });
            const data = await res.json();
            if (data.success) {
                alert(`Cleaned ${data.stats.cleaned} questions (out of ${data.stats.total}).`);
                router.refresh();
            } else {
                alert('Error: ' + data.error);
            }
        } catch (e) {
            alert('Failed to clean questions');
            console.error(e);
        } finally {
            setProcessingClean(false);
        }
    };

    const [processingLatex, setProcessingLatex] = useState(false);

    const handleImageClean = async () => {
        if (!selectedTestId) return;
        if (!confirm('Clean Question Images? This will:\n1. Move extra images from question text to options.\n2. Convert all involved images to Grayscale.')) return;

        setProcessingImageClean(true);
        try {
            const res = await fetch('/api/paper/clean-images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paper_session_id: selectedTestId })
            });
            const data = await res.json();
            if (data.success) {
                alert(`Processed ${data.stats.processed} questions.\nMoved ${data.stats.imagesMoved} images.\nConverted ${data.stats.grayscaleConverted} images to grayscale.`);
                router.refresh();
            } else {
                alert('Error: ' + data.error);
            }
        } catch (e) {
            alert('Failed to process images');
            console.error(e);
        } finally {
            setProcessingImageClean(false);
        }
    };

    const handleFixLatex = async () => {
        if (!selectedTestId) return;
        if (!confirm('Fix LaTeX Syntax Errors?\nThis will repair malformed math (e.g. 8}^{m} -> 8^{m}) in logic and options.')) return;

        setProcessingLatex(true);
        try {
            const res = await fetch('/api/paper/fix-latex', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paper_session_id: selectedTestId })
            });
            const data = await res.json();
            if (data.success) {
                alert(`Fixed LaTeX errors.\nQuestions Corrected: ${data.stats.questionsFixed}\nOptions Corrected: ${data.stats.optionsFixed}`);
                router.refresh();
            } else {
                alert('Error: ' + data.error);
            }
        } catch (e) {
            alert('Failed to fix LaTeX');
            console.error(e);
        } finally {
            setProcessingLatex(false);
        }
    };

    // Group questions by subject
    const groupedQuestions = questions.reduce((acc, q) => {
        const subject = q.subject || 'General';
        if (!acc[subject]) acc[subject] = [];
        acc[subject].push(q);
        return acc;
    }, {});

    // Calculate Stats
    const expectedPerSection = (sections.length > 0 && docInfo?.num_questions)
        ? Math.round(parseInt(docInfo.num_questions) / sections.length)
        : null;
    const sectionStats = Object.entries(groupedQuestions).map(([subject, qs]) => ({
        subject,
        count: qs.length,
        isOversized: expectedPerSection ? qs.length > expectedPerSection * 1.5 : false,
        isUndersized: expectedPerSection ? qs.length < expectedPerSection * 0.5 : false
    }));
    const hasImbalance = sectionStats.some(s => s.isOversized || s.isUndersized)
        || (sections.length > 0 && sectionStats.length < sections.length);

    // Determine max questions per section based on exam type
    const examName = (docInfo?.exam_name || '').toUpperCase();
    const examCode = (docInfo?.exam_code || '').toUpperCase();
    const isGD = examCode.includes('GD') || examName.includes('GD') || examName.includes('CONSTABLE');
    const maxPerSection = isGD ? 20 : 25;

    // Detect oversized sections
    const oversizedSections = Object.entries(groupedQuestions)
        .filter(([, qs]) => qs.length > maxPerSection)
        .map(([subject, qs]) => ({ subject, count: qs.length, extra: qs.length - maxPerSection }));

    // Detect duplicate Q.Nos within each section (extras to reclassify)
    const duplicateQNos = [];
    Object.entries(groupedQuestions).forEach(([subject, qs]) => {
        const qnoMap = {};
        qs.forEach(q => {
            const qno = q.source_q_no ? q.source_q_no.replace(/Q\.\s*/, '').trim() : null;
            if (qno) {
                if (!qnoMap[qno]) qnoMap[qno] = [];
                qnoMap[qno].push(q.id);
            }
        });
        Object.entries(qnoMap).forEach(([qno, ids]) => {
            if (ids.length > 1) {
                duplicateQNos.push({ subject, qno, ids });
            }
        });
    });

    // Build set of duplicate question IDs for highlighting
    const duplicateQuestionIds = new Set();
    duplicateQNos.forEach(d => d.ids.slice(1).forEach(id => duplicateQuestionIds.add(id)));

    // Detect missing Q.Nos per section
    const missingQNos = [];
    Object.entries(groupedQuestions).forEach(([subject, qs]) => {
        const nums = qs
            .map(q => {
                const match = (q.source_q_no || '').match(/(\d+)/);
                return match ? parseInt(match[1]) : null;
            })
            .filter(n => n !== null)
            .sort((a, b) => a - b);
        if (nums.length === 0) return;
        const min = nums[0];
        const max = Math.min(nums[nums.length - 1], min + maxPerSection - 1);
        const missing = [];
        for (let i = min; i <= max; i++) {
            if (!nums.includes(i)) missing.push(i);
        }
        if (missing.length > 0) {
            missingQNos.push({ subject, missing });
        }
    });

    const paramsMissingQuestions = questions.filter(q => {
        const missingOptions = !q.options || q.options.length < 4;
        const hasErroneousText = (q.question_text && q.question_text.includes("Question ID :")) ||
            (q.options && q.options.some(opt => opt.opt_text && opt.opt_text.includes("Question ID :")));
        return missingOptions || hasErroneousText;
    });

    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedQuestions, setSelectedQuestions] = useState(new Set());
    const [targetSection, setTargetSection] = useState('');

    const toggleQuestionSelection = (id) => {
        const newSelection = new Set(selectedQuestions);
        if (newSelection.has(id)) {
            newSelection.delete(id);
        } else {
            newSelection.add(id);
        }
        setSelectedQuestions(newSelection);
    };

    const handleBulkMove = async () => {
        if (selectedQuestions.size === 0 || !targetSection) return;

        const section = sections.find(s => s.section_id === targetSection);
        if (!section) return;

        if (!confirm(`Move ${selectedQuestions.size} questions to ${section.name}?`)) return;

        try {
            const res = await fetch('/api/question/bulk-update-section', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_ids: Array.from(selectedQuestions),
                    section_id: section.section_id,
                    section_name: section.code, // Use code for consistency
                    paper_session_id: selectedTestId
                })
            });
            const data = await res.json();
            if (data.success) {
                alert(data.message);
                setIsSelectMode(false);
                setSelectedQuestions(new Set());
                router.refresh();
            } else {
                alert('Error: ' + data.error);
            }
        } catch (e) {
            alert('Bulk move failed');
            console.error(e);
        }
    };

    return (
        <div className="container mx-auto px-4 py-8">
            {/* Header Section */}
            <header className="mb-8">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">MCQ Review Dashboard</h1>
                        <div className="text-sm text-gray-500 mt-1">
                            Reviewing <span className="font-semibold text-gray-900">{questions.length}</span> Questions
                        </div>
                        {/* Doc Links */}
                        {docInfo && (
                            <div className="flex gap-2 text-xs mt-2 flex-wrap">
                                {renderDocLink(docInfo.source_pdf_path, 'Source PDF', 'text-red-600')}
                                {docInfo.mmd_doc_id && (
                                    <a href={`/api/mmd?id=${docInfo.mmd_doc_id}`} target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline flex items-center gap-1 bg-white border border-gray-200 px-2 py-1 rounded shadow-sm" title="View raw MMD text">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-gray-500">
                                            <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" />
                                            <path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" />
                                        </svg>
                                        <span className="truncate max-w-[150px]">Source MMD</span>
                                    </a>
                                )}
                                {docInfo.notes && (
                                    <span className="text-gray-400 italic border border-gray-100 px-2 py-1 rounded bg-gray-50" title={docInfo.notes}>
                                        {docInfo.notes.replace(/ingested from\s*/i, '').trim().substring(0, 30)}...
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col md:flex-row gap-4 items-center w-full md:w-auto">
                        {/* Test Selector & Bilingual Link */}
                        {tests && tests.length > 0 && activeTab === 'test-paper' && (
                            <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                                <div className="w-full md:w-72">
                                    {/* If locked (and not admin), show text only. Else show selector */}
                                    {locked && !isAdmin ? (
                                        <div className="w-full bg-gray-100 border border-gray-300 text-gray-700 py-2 px-3 rounded-md shadow-sm text-sm font-semibold truncate cursor-not-allowed" title="Test selection locked for review">
                                            {tests.find(t => t.paper_session_id === selectedTestId)?.session_label || `Test ${selectedTestId}`}
                                            <span className="float-right text-xs text-gray-400 font-normal ml-2">(Locked)</span>
                                        </div>
                                    ) : (
                                        <select
                                            value={selectedTestId || ''}
                                            onChange={handleTestChange}
                                            className="w-full bg-white border border-gray-300 text-gray-700 py-2 px-3 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                                        >
                                            <option value="">Select Test Paper...</option>
                                            {tests.map(t => (
                                                <option key={t.paper_session_id} value={t.paper_session_id}>
                                                    {t.session_label || `Test ${t.paper_session_id}`}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                                {selectedTestId && (
                                    <>
                                        <Link href={`/bilingual/${selectedTestId}`} className="shrink-0">
                                            <button className="w-full sm:w-auto px-4 py-2 bg-purple-600 text-white text-sm font-bold rounded-md hover:bg-purple-700 transition-colors shadow-sm flex items-center justify-center gap-2">
                                                <span>Bilingual Review</span>
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                                                </svg>
                                            </button>
                                        </Link>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Tabs */}
                        <div className="bg-gray-100 p-1 rounded-lg flex gap-1 whitespace-nowrap">
                            <button
                                onClick={() => setActiveTab('test-paper')}
                                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'test-paper'
                                    ? 'bg-white text-blue-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                Test Paper
                            </button>
                            <button
                                onClick={() => setActiveTab('solution-checker')}
                                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'solution-checker'
                                    ? 'bg-white text-blue-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                Solution Checker
                            </button>
                        </div>
                    </div>
                </div>

                {/* Stats Summary Bar */}
                {activeTab === 'test-paper' && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm flex flex-wrap gap-6 text-sm">
                        <div className="flex items-center gap-2">
                            <span className="text-gray-500">Total:</span>
                            <span className="font-bold text-gray-900 text-lg">{questions.length}</span>
                        </div>
                        <div className="w-px h-8 bg-gray-200 hidden md:block"></div>

                        {sectionStats.map(stat => (
                            <div key={stat.subject} className="flex items-center gap-2 group">
                                <span className="text-gray-500">{stat.subject}:</span>
                                <span className={`font-semibold px-2 py-0.5 rounded ${stat.isOversized ? 'text-red-700 bg-red-50 border border-red-200' : stat.isUndersized ? 'text-amber-700 bg-amber-50 border border-amber-200' : 'text-gray-900 bg-gray-100'}`}>{stat.count}</span>
                                <button
                                    onClick={() => handleReclassify(stat.subject)}
                                    disabled={processingSection === stat.subject}
                                    title={`Reclassify questions in ${stat.subject}`}
                                    className="ml-1 p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
                                >
                                    {processingSection === stat.subject ? (
                                        <svg className="animate-spin h-3.5 w-3.5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                                            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0v2.436l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        ))}

                        {hasImbalance && (
                            <>
                                <div className="w-px h-8 bg-gray-200 hidden md:block"></div>
                                <button
                                    onClick={handleSmartReclassify}
                                    disabled={processingSection === '__smart__'}
                                    title="Smart reclassify: only sends oversized section questions, classifies into oversized+undersized sections only"
                                    className="px-3 py-1.5 text-xs font-bold bg-violet-50 text-violet-700 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                >
                                    {processingSection === '__smart__' ? (
                                        <>
                                            <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            Processing...
                                        </>
                                    ) : (
                                        <>Smart Reclassify</>
                                    )}
                                </button>
                            </>
                        )}

                        {paramsMissingQuestions.length > 0 && (
                            <>
                                <div className="w-px h-8 bg-gray-200 hidden md:block"></div>
                                <div className="flex items-center gap-2 text-red-600">
                                    <span className="font-bold">⚠ Attention Needed:</span>
                                    <span className="font-bold bg-red-50 px-2 py-0.5 rounded border border-red-100">
                                        {paramsMissingQuestions.length} Questions (options &lt; 4 or content errors)
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Diagnostic Messages */}
                {activeTab === 'test-paper' && (oversizedSections.length > 0 || missingQNos.length > 0) && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm space-y-2 text-sm">
                        {oversizedSections.map(s => (
                            <div key={s.subject} className="flex items-start gap-2 text-red-700">
                                <span className="font-bold shrink-0">Oversized:</span>
                                <span><strong>{s.subject}</strong> has {s.count} questions (max {maxPerSection}). {s.extra} extra question{s.extra > 1 ? 's' : ''} need to be reclassified. Look for duplicate Q.Nos.</span>
                            </div>
                        ))}
                        {duplicateQNos.length > 0 && (
                            <div className="flex items-start gap-2 text-red-700">
                                <span className="font-bold shrink-0">Duplicates:</span>
                                <span>
                                    {duplicateQNos.map((d, i) => (
                                        <span key={i}>{i > 0 && ', '}<strong>{d.subject}</strong> Q.{d.qno} ({d.ids.length}x)</span>
                                    ))}
                                    {' '}— extra copies highlighted in dark red in sidebar
                                </span>
                            </div>
                        )}
                        {missingQNos.map(s => (
                            <div key={s.subject} className="flex items-start gap-2 text-amber-700">
                                <span className="font-bold shrink-0">Missing:</span>
                                <span><strong>{s.subject}</strong> — Q.No {s.missing.join(', ')}</span>
                            </div>
                        ))}
                    </div>
                )}
            </header>

            <div className="tab-content relative">
                {activeTab === 'test-paper' ? (
                    <div className="flex flex-col lg:flex-row gap-8 items-start">
                        {/* LEFT SIDEBAR: Sticky */}
                        <aside className="hidden lg:block w-64 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto bg-white rounded-lg border border-gray-200 shadow-sm p-4 shrink-0 scrollbar-thin scrollbar-thumb-gray-300">
                            <div className="flex justify-between items-center mb-4 border-b border-gray-100 pb-2">
                                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                                    Reclassify
                                </h3>
                                <button
                                    onClick={() => {
                                        setIsSelectMode(!isSelectMode);
                                        setSelectedQuestions(new Set());
                                    }}
                                    className={`text-xs px-2 py-1 rounded border ${isSelectMode ? 'bg-blue-100 text-blue-700 border-blue-200' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                                >
                                    {isSelectMode ? 'Cancel' : 'Select'}
                                </button>
                            </div>

                            {isSelectMode && (
                                <div className="mb-4 p-2 bg-blue-50 rounded border border-blue-100">
                                    <div className="text-xs font-semibold text-blue-800 mb-2">
                                        Selected: {selectedQuestions.size}
                                    </div>
                                    <select
                                        value={targetSection}
                                        onChange={(e) => setTargetSection(e.target.value)}
                                        className="w-full text-xs p-1 mb-2 border rounded"
                                    >
                                        <option value="">Move to...</option>
                                        {sections.map(s => (
                                            <option key={s.section_id} value={s.section_id}>{s.name} ({s.code})</option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={handleBulkMove}
                                        disabled={selectedQuestions.size === 0 || !targetSection}
                                        className="w-full bg-blue-600 text-white text-xs py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        Apply
                                    </button>
                                </div>
                            )}

                            <div className="space-y-6">
                                {Object.entries(groupedQuestions).map(([subject, qs]) => (
                                    <div key={subject}>
                                        <div className="flex justify-between items-center mb-2">
                                            <h4 className="text-xs font-bold text-gray-700 truncate" title={subject}>
                                                {subject}
                                            </h4>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={async () => {
                                                        if (!confirm(`Add a new blank question to ${subject}?`)) return;
                                                        try {
                                                            const res = await fetch('/api/question/create', {
                                                                method: 'POST',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({
                                                                    paper_session_id: selectedTestId,
                                                                    section_name: subject
                                                                })
                                                            });
                                                            const d = await res.json();
                                                            if (d.success) {
                                                                router.refresh();
                                                            } else {
                                                                alert('Error: ' + d.error);
                                                            }
                                                        } catch (e) {
                                                            alert('Failed to create question');
                                                        }
                                                    }}
                                                    className="text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 px-1.5 py-0.5 rounded border border-blue-100 flex items-center gap-0.5"
                                                    title="Add new question to this section"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                                        <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                                                    </svg>
                                                    Add
                                                </button>
                                                <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{qs.length}</span>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-4 gap-2">
                                            {qs.map((q) => {
                                                const missingOptions = !q.options || q.options.length < 4;
                                                const hasErroneousText = (q.question_text && q.question_text.includes("Question ID :")) ||
                                                    (q.options && q.options.some(opt => opt.opt_text && opt.opt_text.includes("Question ID :")));
                                                const hasError = missingOptions || hasErroneousText;
                                                return (
                                                    <div key={q.id} className="relative">
                                                        {isSelectMode ? (
                                                            <div
                                                                onClick={() => toggleQuestionSelection(q.id)}
                                                                className={`flex items-center justify-center w-full aspect-square text-xs font-medium rounded border cursor-pointer ${selectedQuestions.has(q.id)
                                                                    ? 'bg-blue-600 text-white border-blue-600'
                                                                    : 'bg-white text-gray-400 border-gray-200 hover:border-blue-400'
                                                                    }`}
                                                            >
                                                                {selectedQuestions.has(q.id) ? (
                                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                                                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                                                                    </svg>
                                                                ) : (
                                                                    q.source_q_no ? q.source_q_no.replace(/Q\.\s*/, '').trim() : q.q_no
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <a
                                                                href={`#q-${q.id}`}
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    const el = document.getElementById(`q-${q.id}`);
                                                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                                }}
                                                                className={`flex items-center justify-center w-full aspect-square text-xs font-medium rounded border transition-colors ${duplicateQuestionIds.has(q.id)
                                                                    ? 'bg-red-800 text-white border-red-900 hover:bg-red-700 ring-2 ring-red-400'
                                                                    : q.is_unlinked
                                                                        ? 'bg-red-900 text-white border-red-950 hover:bg-red-800'
                                                                        : hasError
                                                                            ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                                                            : 'text-gray-600 bg-gray-50 hover:bg-blue-100 hover:text-blue-600 border-gray-200'
                                                                    }`}
                                                                title={duplicateQuestionIds.has(q.id) ? 'Duplicate Q.No — needs reclassification' : q.is_unlinked ? 'Unlinked (No Bilingual Match)' : (hasError ? 'Less than 4 options' : '')}
                                                            >
                                                                {q.source_q_no ? q.source_q_no.replace(/Q\.\s*/, '').trim() : q.q_no}
                                                            </a>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </aside>

                        {/* MAIN CONTENT */}
                        <div className="flex-1 w-full max-w-[800px] mx-auto space-y-8 min-w-0">
                            {questions.map((q) => (
                                <div
                                    key={q.id}
                                    id={`q-${q.id}`}
                                    className={`transition-all duration-200 rounded-lg ${isSelectMode && selectedQuestions.has(q.id)
                                        ? 'ring-2 ring-blue-500 bg-blue-50/50 p-2 -mx-2'
                                        : 'border-transparent'
                                        }`}
                                >
                                    <QuestionCard
                                        question={q}
                                        onImagePaste={(blob, targetQ, optIndex, onInsert) => handleImagePaste(blob, targetQ, optIndex, onInsert)}
                                        onAddImage={(targetQ) => handleAddImage(targetQ)}
                                        onSave={async (updatedQ) => {
                                            // Check if it is a delete action
                                            if (updatedQ.isDeleted) {
                                                try {
                                                    const res = await fetch('/api/question/delete', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ question_id: updatedQ.id })
                                                    });
                                                    const data = await res.json();
                                                    if (data.success) {
                                                        router.refresh();
                                                        return;
                                                    } else {
                                                        throw new Error(data.error);
                                                    }
                                                } catch (e) {
                                                    alert('Failed to delete question: ' + e.message);
                                                    throw e;
                                                }
                                            }

                                            // Save Logic
                                            try {
                                                const res = await fetch('/api/question/save', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({
                                                        id: updatedQ.id,
                                                        version_no: updatedQ.version_no || 1,
                                                        language: updatedQ.language || 'EN',
                                                        question_text: updatedQ.question_text,
                                                        options: updatedQ.options,
                                                        source_question_no: updatedQ.source_q_no
                                                    })
                                                });
                                                const data = await res.json();
                                                if (data.success) {
                                                    router.refresh();
                                                } else {
                                                    alert('Error saving: ' + data.error);
                                                }
                                            } catch (e) {
                                                console.error(e);
                                                alert('Error saving question');
                                            }
                                        }}
                                    />
                                </div>
                            ))}
                            {questions.length === 0 && (
                                <div className="text-center py-20 bg-white rounded-lg border border-gray-200">
                                    <p className="text-gray-500">No questions found for the selected test.</p>
                                </div>
                            )}

                            {isAdmin && ['TEAM_REVIEWED', 'ADMIN_REVIEWED'].includes(docInfo?.status) && (
                                <div className="mt-8 pt-8 border-t border-gray-200 flex flex-col items-center justify-center text-center bg-gray-50 rounded-lg p-6 border">
                                    <h3 className="text-xl font-bold text-gray-800 mb-2">Complete Missing Questions Phase</h3>
                                    <p className="text-gray-600 mb-6 max-w-xl">
                                        Are you sure you want to mark this paper as having all missing questions added?
                                        This will advance the paper out of <span className="font-semibold text-gray-800">{docInfo?.status}</span> and into the <strong className="text-blue-700">Missing Added</strong> stage.
                                        <br /><br />
                                        <span className={`font-semibold bg-white px-3 py-1.5 rounded border shadow-sm ${total === parseInt(docInfo?.num_questions || 100, 10) ? 'text-green-600 border-green-200' : 'text-red-600 border-red-200'}`}>
                                            Current Question Count: {total} / {docInfo?.num_questions || 100}
                                        </span>
                                    </p>
                                    <button
                                        onClick={async () => {
                                            const targetCount = parseInt(docInfo?.num_questions || 100, 10);
                                            if (total !== targetCount) {
                                                alert(`Cannot advance: This exam requires exactly ${targetCount} questions.`);
                                                return;
                                            }
                                            if (confirm('Advance paper to MISSING_ADDED?')) {
                                                try {
                                                    const res = await fetch('/api/paper/advance-status', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({
                                                            paper_session_id: selectedTestId,
                                                            next_status: 'MISSING_ADDED'
                                                        })
                                                    });
                                                    if (res.ok) {
                                                        alert('Status updated successfully!');
                                                        router.refresh();
                                                    } else {
                                                        const data = await res.json();
                                                        alert(data.error || 'Failed to update status');
                                                    }
                                                } catch (e) {
                                                    alert('An error occurred.');
                                                }
                                            }
                                        }}
                                        className={`px-8 py-3 rounded-lg shadow text-white font-bold text-sm transition-colors ${total === parseInt(docInfo?.num_questions || 100, 10) ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed opacity-80'}`}
                                        disabled={total !== parseInt(docInfo?.num_questions || 100, 10)}
                                    >
                                        Mark as "Missing Added"
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    // Logic for Solution Checker View (Legacy)
                    <div className="max-w-4xl mx-auto grid gap-4">
                        {questions.map((q) => (
                            <div key={q.id} className="card flex justify-between items-center bg-white p-4 rounded shadow-sm border border-gray-200">
                                <div>
                                    <div className="flex gap-2 items-center mb-2">
                                        <span className="bg-gray-100 text-gray-700 text-xs font-semibold px-2.5 py-0.5 rounded">Q.{q.source_q_no || q.q_no}</span>
                                        <span className="text-sm font-semibold text-gray-600">{q.exam}</span>
                                    </div>
                                    <p className="text-sm text-gray-500 truncate w-full max-w-2xl">
                                        {q.question_text.substring(0, 100)}...
                                    </p>
                                </div>
                                <Link href={`/question/${q.id}`}>
                                    <button className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded text-sm transition-colors">
                                        Edit / Review
                                    </button>
                                </Link>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <ImageEditor
                isOpen={imageEditor.isOpen}
                imageDataUrl={imageEditor.imageDataUrl}
                onSave={handleImageEditorSave}
                onCancel={() => setImageEditor({ isOpen: false, imageDataUrl: null, targetQuestion: null })}
            />
        </div >
    );
}
