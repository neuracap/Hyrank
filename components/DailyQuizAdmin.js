'use client';

import { useState, useEffect } from 'react';
import Latex from './Latex';

const LEVELS = ['SSC', 'BANKING', 'UPSC'];
const OPTION_KEYS = ['A', 'B', 'C', 'D'];

function QuestionForm({ quiz, questionData, onSaved, onCancel }) {
    const [q, setQ] = useState({
        question_text_en: '', question_text_hi: '',
        option_a_en: '', option_a_hi: '',
        option_b_en: '', option_b_hi: '',
        option_c_en: '', option_c_hi: '',
        option_d_en: '', option_d_hi: '',
        correct_option: '',
        explanation_en: '', explanation_hi: '',
        ...questionData
    });
    const [saving, setSaving] = useState(false);
    const [translating, setTranslating] = useState(false);

    const handleTranslate = async () => {
        setTranslating(true);
        try {
            const fields = [
                ['question_text_en', 'question_text_hi'],
                ['option_a_en', 'option_a_hi'],
                ['option_b_en', 'option_b_hi'],
                ['option_c_en', 'option_c_hi'],
                ['option_d_en', 'option_d_hi'],
                ['explanation_en', 'explanation_hi'],
            ];
            const updates = {};
            for (const [src, tgt] of fields) {
                if (q[src]?.trim()) {
                    const res = await fetch('/api/translate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: q[src], source: 'en', target: 'hi' })
                    });
                    const data = await res.json();
                    if (data.translatedText) updates[tgt] = data.translatedText;
                }
            }
            setQ(prev => ({ ...prev, ...updates }));
        } catch (e) {
            alert('Translation failed');
        } finally {
            setTranslating(false);
        }
    };

    const handleSave = async () => {
        if (!q.correct_option) {
            alert('Please select the correct answer');
            return;
        }
        if (!q.question_text_en?.trim()) {
            alert('Please enter question text');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/daily-quiz/questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quiz_id: quiz.quiz_id, ...q })
            });
            const data = await res.json();
            if (data.success) {
                onSaved();
            } else {
                alert('Save failed: ' + data.error);
            }
        } catch (e) {
            alert('Error: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    const set = (field, val) => setQ(prev => ({ ...prev, [field]: val }));

    return (
        <div className="border-2 border-blue-300 rounded-xl bg-blue-50/30 p-5 mb-4">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800">
                    {questionData?.question_id ? 'Edit Question' : 'Add Question'}
                </h3>
                <div className="flex gap-2">
                    <button onClick={handleTranslate} disabled={translating}
                        className="px-3 py-1 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-50">
                        {translating ? 'Translating...' : 'Translate EN → HI'}
                    </button>
                    <button onClick={onCancel} className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                </div>
            </div>

            {/* Question Text */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Question (EN)</label>
                    <textarea className="w-full p-2 border border-gray-300 rounded text-sm font-mono min-h-[80px] resize-y"
                        value={q.question_text_en} onChange={e => set('question_text_en', e.target.value)}
                        placeholder="Enter question in English..." />
                    <div className="mt-1 p-2 bg-white rounded border text-sm"><Latex>{q.question_text_en || ''}</Latex></div>
                </div>
                <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Question (HI)</label>
                    <textarea className="w-full p-2 border border-gray-300 rounded text-sm font-mono min-h-[80px] resize-y"
                        value={q.question_text_hi} onChange={e => set('question_text_hi', e.target.value)}
                        placeholder="हिंदी प्रश्न..." />
                    <div className="mt-1 p-2 bg-white rounded border text-sm"><Latex>{q.question_text_hi || ''}</Latex></div>
                </div>
            </div>

            {/* Options */}
            {[['A', 'option_a'], ['B', 'option_b'], ['C', 'option_c'], ['D', 'option_d']].map(([label, key]) => (
                <div key={label} className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
                    <div className="flex gap-2 items-center">
                        <button type="button" onClick={() => set('correct_option', label)}
                            className={`w-7 h-7 rounded-full text-xs font-bold shrink-0 ${q.correct_option === label
                                ? 'bg-green-600 text-white' : 'bg-white border border-gray-300 text-gray-500'}`}>
                            {label}
                        </button>
                        <input className="flex-1 text-xs p-1.5 border border-gray-300 rounded font-mono"
                            value={q[`${key}_en`] || ''} onChange={e => set(`${key}_en`, e.target.value)}
                            placeholder={`Option ${label} (EN)`} />
                    </div>
                    <input className="text-xs p-1.5 border border-gray-300 rounded font-mono"
                        value={q[`${key}_hi`] || ''} onChange={e => set(`${key}_hi`, e.target.value)}
                        placeholder={`विकल्प ${label} (HI)`} />
                </div>
            ))}

            {/* Explanation */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 mb-4">
                <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Explanation (EN)</label>
                    <textarea className="w-full p-2 border border-gray-300 rounded text-sm font-mono min-h-[60px] resize-y"
                        value={q.explanation_en} onChange={e => set('explanation_en', e.target.value)}
                        placeholder="Why is this the correct answer? (optional)" />
                </div>
                <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Explanation (HI)</label>
                    <textarea className="w-full p-2 border border-gray-300 rounded text-sm font-mono min-h-[60px] resize-y"
                        value={q.explanation_hi} onChange={e => set('explanation_hi', e.target.value)}
                        placeholder="सही उत्तर का कारण (वैकल्पिक)" />
                </div>
            </div>

            <button onClick={handleSave} disabled={saving}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Question'}
            </button>
        </div>
    );
}

function QuizCard({ quiz, onRefresh }) {
    const [expanded, setExpanded] = useState(false);
    const [questions, setQuestions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [addingQuestion, setAddingQuestion] = useState(false);
    const [editingQuestion, setEditingQuestion] = useState(null);
    const [updating, setUpdating] = useState(false);

    const loadQuestions = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/daily-quiz/questions?quiz_id=${quiz.quiz_id}&mode=admin`);
            const data = await res.json();
            setQuestions(data.questions || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleExpand = () => {
        if (!expanded) loadQuestions();
        setExpanded(!expanded);
    };

    const handleStatusChange = async (newStatus) => {
        setUpdating(true);
        try {
            const res = await fetch('/api/daily-quiz', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quiz_id: quiz.quiz_id, status: newStatus })
            });
            if ((await res.json()).success) onRefresh();
        } catch (e) {
            alert('Failed to update status');
        } finally {
            setUpdating(false);
        }
    };

    const handleDeleteQuestion = async (question_id) => {
        if (!confirm('Delete this question?')) return;
        try {
            await fetch('/api/daily-quiz/questions', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id })
            });
            loadQuestions();
        } catch (e) {
            alert('Failed to delete');
        }
    };

    const levelColors = {
        SSC: 'bg-blue-100 text-blue-800 border-blue-300',
        BANKING: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        UPSC: 'bg-purple-100 text-purple-800 border-purple-300'
    };

    const statusColors = {
        DRAFT: 'bg-gray-100 text-gray-600',
        APPROVED: 'bg-green-100 text-green-700',
        PUBLISHED: 'bg-blue-100 text-blue-700'
    };

    return (
        <div className={`border rounded-xl overflow-hidden mb-3 ${quiz.status === 'APPROVED' ? 'border-green-300' : 'border-gray-200'}`}>
            <div className="px-5 py-3 bg-white flex items-center justify-between cursor-pointer hover:bg-gray-50" onClick={handleExpand}>
                <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded text-xs font-bold border ${levelColors[quiz.level]}`}>{quiz.level}</span>
                    <span className="text-sm font-bold text-gray-800">{quiz.quiz_date}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusColors[quiz.status]}`}>{quiz.status}</span>
                    <span className="text-xs text-gray-400">{quiz.question_count || 0}/5 questions</span>
                </div>
                <div className="flex items-center gap-2">
                    {quiz.status === 'DRAFT' && (
                        <button onClick={(e) => { e.stopPropagation(); handleStatusChange('APPROVED'); }}
                            disabled={updating || quiz.question_count < 5}
                            className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                            title={quiz.question_count < 5 ? 'Need 5 questions to approve' : 'Approve quiz'}>
                            Approve
                        </button>
                    )}
                    {quiz.status === 'APPROVED' && (
                        <button onClick={(e) => { e.stopPropagation(); handleStatusChange('DRAFT'); }}
                            disabled={updating}
                            className="px-3 py-1 text-xs font-bold bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50">
                            Revert to Draft
                        </button>
                    )}
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </div>

            {expanded && (
                <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50">
                    {loading ? (
                        <p className="text-sm text-gray-400">Loading...</p>
                    ) : (
                        <>
                            {questions.map((q, i) => (
                                <div key={q.question_id} className="bg-white rounded-lg border border-gray-200 p-4 mb-3">
                                    {editingQuestion === q.question_id ? (
                                        <QuestionForm quiz={quiz} questionData={q}
                                            onSaved={() => { setEditingQuestion(null); loadQuestions(); }}
                                            onCancel={() => setEditingQuestion(null)} />
                                    ) : (
                                        <div>
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">{q.question_order}</span>
                                                    <span className="text-sm font-medium text-gray-800"><Latex>{q.question_text_en}</Latex></span>
                                                </div>
                                                <div className="flex gap-1 shrink-0">
                                                    <button onClick={() => setEditingQuestion(q.question_id)}
                                                        className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded">Edit</button>
                                                    <button onClick={() => handleDeleteQuestion(q.question_id)}
                                                        className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded">Delete</button>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-1 pl-8 text-xs text-gray-600">
                                                {['A', 'B', 'C', 'D'].map(opt => {
                                                    const key = `option_${opt.toLowerCase()}_en`;
                                                    return (
                                                        <span key={opt} className={`${q.correct_option === opt ? 'text-green-700 font-bold' : ''}`}>
                                                            {opt}. {q[key]}
                                                            {q.correct_option === opt && ' ✓'}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                            {q.explanation_en && (
                                                <p className="pl-8 mt-1 text-xs text-gray-400 italic">{q.explanation_en.substring(0, 100)}{q.explanation_en.length > 100 ? '...' : ''}</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}

                            {addingQuestion ? (
                                <QuestionForm quiz={quiz}
                                    onSaved={() => { setAddingQuestion(false); loadQuestions(); }}
                                    onCancel={() => setAddingQuestion(false)} />
                            ) : (
                                questions.length < 5 && (
                                    <button onClick={() => setAddingQuestion(true)}
                                        className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-sm font-semibold text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
                                        + Add Question ({questions.length}/5)
                                    </button>
                                )
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

export default function DailyQuizAdmin() {
    const [quizzes, setQuizzes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
    const [newLevel, setNewLevel] = useState('SSC');
    const [creating, setCreating] = useState(false);
    const [message, setMessage] = useState(null);

    const fetchQuizzes = async () => {
        try {
            const res = await fetch('/api/daily-quiz?mode=admin');
            const data = await res.json();
            setQuizzes(data.quizzes || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchQuizzes(); }, []);

    const handleCreate = async () => {
        setCreating(true);
        setMessage(null);
        try {
            const res = await fetch('/api/daily-quiz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quiz_date: newDate, level: newLevel })
            });
            const data = await res.json();
            if (data.success) {
                setMessage({ type: 'success', text: `${newLevel} quiz created for ${newDate}` });
                fetchQuizzes();
            } else {
                setMessage({ type: 'error', text: data.error });
            }
        } catch (e) {
            setMessage({ type: 'error', text: e.message });
        } finally {
            setCreating(false);
        }
    };

    const handleCreateAll = async () => {
        setCreating(true);
        setMessage(null);
        let created = 0;
        for (const level of LEVELS) {
            try {
                const res = await fetch('/api/daily-quiz', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ quiz_date: newDate, level })
                });
                const data = await res.json();
                if (data.success) created++;
            } catch (e) { /* skip duplicates */ }
        }
        setMessage({ type: 'success', text: `Created ${created} quizzes for ${newDate}` });
        fetchQuizzes();
        setCreating(false);
    };

    if (loading) return <div className="text-center py-16 text-gray-400">Loading...</div>;

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900 mb-1">Daily Quiz Manager</h1>
                <p className="text-sm text-gray-500">Create and manage daily quizzes for SSC, Banking, and UPSC levels.</p>
            </div>

            {/* Create Bar */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-6">
                <div className="flex flex-wrap gap-4 items-end">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Date</label>
                        <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Level</label>
                        <select value={newLevel} onChange={e => setNewLevel(e.target.value)}
                            className="border border-gray-300 rounded-md px-3 py-2 text-sm">
                            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </div>
                    <button onClick={handleCreate} disabled={creating}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                        Create Quiz
                    </button>
                    <button onClick={handleCreateAll} disabled={creating}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-bold hover:bg-purple-700 disabled:opacity-50">
                        Create All 3 for Date
                    </button>
                </div>
            </div>

            {message && (
                <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${message.type === 'success'
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200'}`}>
                    {message.text}
                </div>
            )}

            {/* Quiz List */}
            {quizzes.length === 0 ? (
                <div className="text-center py-16 text-gray-400">No quizzes yet. Create one above.</div>
            ) : (
                quizzes.map(q => (
                    <QuizCard key={q.quiz_id} quiz={q} onRefresh={fetchQuizzes} />
                ))
            )}
        </div>
    );
}
