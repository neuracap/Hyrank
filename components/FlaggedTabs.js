'use client';

import { useState } from 'react';
import BilingualList from '@/components/BilingualList';
import Latex from '@/components/Latex';

function SoloFlaggedList({ questions }) {
    const [saving, setSaving] = useState({});
    const [statuses, setStatuses] = useState({});
    const [editTexts, setEditTexts] = useState({});

    const handleUnflag = async (q) => {
        const key = `${q.question_id}_${q.version_no}`;
        setSaving(prev => ({ ...prev, [key]: true }));
        try {
            const res = await fetch('/api/flagged/solo-unflag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: q.question_id,
                    version_no: q.version_no,
                    language: q.language,
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setStatuses(prev => ({ ...prev, [key]: 'MANUALLY_CORRECTED' }));
            }
        } catch (err) {
            console.error('Unflag error:', err);
        } finally {
            setSaving(prev => ({ ...prev, [key]: false }));
        }
    };

    if (questions.length === 0) {
        return <div className="text-center py-16 text-gray-400">No solo flagged questions found.</div>;
    }

    return (
        <div className="space-y-4">
            {questions.map((q) => {
                const key = `${q.question_id}_${q.version_no}`;
                const currentStatus = statuses[key] || q.status;
                const isUnflagged = currentStatus === 'MANUALLY_CORRECTED';

                return (
                    <div key={key} className={`bg-white rounded-lg border shadow-sm overflow-hidden ${isUnflagged ? 'border-green-300' : 'border-red-300'}`}>
                        {/* Header */}
                        <div className={`px-5 py-3 border-b flex items-center justify-between ${isUnflagged ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold text-gray-700">Q.{q.source_question_no || '?'}</span>
                                <span className="text-xs text-gray-400 font-mono">{q.question_id.slice(0, 8)}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isUnflagged ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {isUnflagged ? 'Corrected' : 'FLAGGED'}
                                </span>
                                <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{q.language}</span>
                                {q.section_code && <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{q.section_code}</span>}
                                {q.exam_name && <span className="text-xs text-gray-500">{q.exam_name}</span>}
                                {q.session_label && <span className="text-xs text-gray-400">| {q.session_label}</span>}
                                {q.source_pdf_path && (
                                    <a href={`/api/pdf?path=${encodeURIComponent(q.source_pdf_path)}`} target="_blank" rel="noopener noreferrer"
                                        className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                                            <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z" />
                                            <path d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z" />
                                        </svg>
                                        PDF
                                    </a>
                                )}
                            </div>
                            <button onClick={() => handleUnflag(q)} disabled={saving[key] || isUnflagged}
                                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-50 transition-colors">
                                {saving[key] ? 'Saving...' : isUnflagged ? 'Corrected' : 'Mark Corrected'}
                            </button>
                        </div>

                        {/* Question text */}
                        <div className="px-5 py-4 border-b border-gray-100">
                            <div className="text-sm text-gray-800">
                                <Latex>{q.question_text || '(No question text)'}</Latex>
                            </div>
                        </div>

                        {/* Options */}
                        {q.options && q.options.length > 0 && (
                            <div className="px-5 py-3 border-b border-gray-100">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    {q.options.map(opt => (
                                        <div key={opt.opt_label} className="flex items-start gap-2 p-2 rounded border border-gray-200 bg-gray-50 text-xs">
                                            <span className="w-5 h-5 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-xs font-bold flex-shrink-0">{opt.opt_label}</span>
                                            <span className="text-gray-700"><Latex>{opt.opt_text || '(image)'}</Latex></span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export default function FlaggedTabs({ linkedQuestions, linkedTotal, linkedPage, linkedTotalPages, soloQuestions, soloTotal }) {
    const [tab, setTab] = useState('linked');

    return (
        <>
            <header className="mb-6 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Flagged Questions</h1>
                <p className="text-sm text-gray-500 mb-4">
                    Questions marked for review across the platform.
                </p>
                <div className="flex gap-2">
                    <button onClick={() => setTab('linked')}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === 'linked' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        Linked ({linkedTotal})
                    </button>
                    <button onClick={() => setTab('solo')}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === 'solo' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        Solo ({soloTotal})
                    </button>
                </div>
            </header>

            {tab === 'linked' ? (
                <BilingualList
                    initialQuestions={linkedQuestions}
                    total={linkedTotal}
                    currentPage={linkedPage}
                    totalPages={linkedTotalPages}
                    isReviewMode={false}
                    isGlobalFlaggedMode={true}
                    paperSessionId="FLAGGED_GLOBAL"
                />
            ) : (
                <SoloFlaggedList questions={soloQuestions} />
            )}
        </>
    );
}
