'use client';

import { useState, useEffect, useRef } from 'react';

const DIFF_MAP = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const CHANNEL_TAG = '@yoloprep';

// Convert LaTeX to plain readable text for Telegram
function stripLatex(text) {
    if (!text) return '';
    return text
        // \underline{\text{...}} → underlined text
        .replace(/\$\\underline\{\\text\{([^}]*)\}\}\$/g, '<u>$1</u>')
        .replace(/\\underline\{\\text\{([^}]*)\}\}/g, '<u>$1</u>')
        .replace(/\\underline\{([^}]*)\}/g, '<u>$1</u>')
        // \text{...} → plain text
        .replace(/\\text\{([^}]*)\}/g, '$1')
        // \textbf{...} → bold
        .replace(/\\textbf\{([^}]*)\}/g, '<b>$1</b>')
        // \frac{a}{b} → a/b
        .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2')
        // x^{2} → x² etc.
        .replace(/\^{2}/g, '²').replace(/\^{3}/g, '³').replace(/\^{n}/g, 'ⁿ')
        .replace(/\^\{([^}]*)\}/g, '^$1')
        // x_{n} → x_n
        .replace(/_\{([^}]*)\}/g, '_$1')
        // \sqrt{x} → √x
        .replace(/\\sqrt\{([^}]*)\}/g, '√$1')
        // \times → ×
        .replace(/\\times/g, '×')
        // \div → ÷
        .replace(/\\div/g, '÷')
        // \pi → π
        .replace(/\\pi/g, 'π')
        // \theta → θ
        .replace(/\\theta/g, 'θ')
        // \alpha, \beta, \gamma
        .replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β').replace(/\\gamma/g, 'γ')
        // \degree or \circ → °
        .replace(/\\degree/g, '°').replace(/\\circ/g, '°')
        // \leq, \geq, \neq
        .replace(/\\leq/g, '≤').replace(/\\geq/g, '≥').replace(/\\neq/g, '≠')
        // \rightarrow → →
        .replace(/\\rightarrow/g, '→').replace(/\\to/g, '→')
        // \infty → ∞
        .replace(/\\infty/g, '∞')
        // \% → %
        .replace(/\\%/g, '%')
        // Strip remaining \command
        .replace(/\\[a-zA-Z]+/g, '')
        // Strip $ delimiters
        .replace(/\$/g, '')
        // Clean up extra spaces
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function formatQuestionAsPost(q) {
    const qText = stripLatex(q.question_text);
    const opts = (q.options || []).map(o => `${o.option_key}) ${stripLatex(o.opt_text || '')}`).join('\n');
    const diff = DIFF_MAP[q.difficulty] || '';
    const section = q.section_code || '';
    return `📝 <b>${q.exam_name || 'Quiz'} — ${section}${diff ? ` (${diff})` : ''}</b>\n\n<b>Q. ${qText}</b>\n\n${opts}\n\n⏰ Think before you scroll!\n\n👉 ${CHANNEL_TAG}`;
}

function formatAnswerReveal(q) {
    const sj = q.solution_json || {};
    const sections = Array.isArray(sj.display_sections) ? sj.display_sections : [];
    const examCraft = sections.find(s => s.key === 'exam_craft')?.content || '';
    const basis = sj.answer_outcome?.core_answer_basis || '';
    return `✅ <b>Answer: ${q.correct_option_label}</b>\n\n💡 <b>Explanation:</b>\n${stripLatex(basis || examCraft)}\n\n📊 Difficulty: ${DIFF_MAP[q.difficulty] || 'N/A'}\n\n👉 ${CHANNEL_TAG}`;
}

// =========================================================
// Image Generator (client-side canvas)
// =========================================================
function QuestionImageGenerator({ question, onGenerated }) {
    const canvasRef = useRef(null);
    const [generated, setGenerated] = useState(false);

    const generate = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = 1080, H = 1080;
        canvas.width = W;
        canvas.height = H;

        // Background
        ctx.fillStyle = '#1e1b4b';
        ctx.fillRect(0, 0, W, H);

        // Top bar
        ctx.fillStyle = '#4f46e5';
        ctx.fillRect(0, 0, W, 100);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText('YOLOPREP DAILY QUIZ', 40, 65);

        // Section badge
        const section = question.section_code || '';
        const diff = DIFF_MAP[question.difficulty] || '';
        ctx.font = '24px sans-serif';
        ctx.fillStyle = '#a5b4fc';
        ctx.fillText(`${question.exam_name || ''} • ${section} • ${diff}`, 40, 150);

        // Question text (word wrap)
        ctx.fillStyle = '#ffffff';
        ctx.font = '32px sans-serif';
        const qText = stripLatex(question.question_text);
        const words = qText.split(' ');
        let line = '';
        let y = 220;
        const maxWidth = W - 80;
        for (const word of words) {
            const test = line + word + ' ';
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line.trim(), 40, y);
                line = word + ' ';
                y += 44;
                if (y > 500) break;
            } else {
                line = test;
            }
        }
        if (line.trim()) ctx.fillText(line.trim(), 40, y);

        // Options
        const opts = question.options || [];
        y = Math.max(y + 80, 540);
        for (const opt of opts) {
            const isCorrect = opt.option_key === question.correct_option_label;
            // Option box
            ctx.fillStyle = isCorrect ? '#065f46' : '#312e81';
            ctx.beginPath();
            ctx.roundRect(40, y - 35, W - 80, 55, 12);
            ctx.fill();
            if (isCorrect) {
                ctx.strokeStyle = '#10b981';
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            // Option text
            ctx.fillStyle = '#ffffff';
            ctx.font = isCorrect ? 'bold 28px sans-serif' : '28px sans-serif';
            const optText = stripLatex(opt.opt_text).substring(0, 60);
            ctx.fillText(`${opt.option_key})  ${optText}`, 60, y);
            y += 70;
        }

        // Footer
        ctx.fillStyle = '#6366f1';
        ctx.fillRect(0, H - 70, W, 70);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText(`yoloprep.com  •  ${CHANNEL_TAG}`, 40, H - 25);

        setGenerated(true);
    };

    const download = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const link = document.createElement('a');
        link.download = `hyrank-quiz-${question.question_id?.slice(0, 8) || 'question'}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    const uploadAndUse = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: reader.result, role: 'social' }),
            });
            const data = await res.json();
            if (data.latexPath && onGenerated) onGenerated(data.latexPath);
        };
    };

    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <button onClick={generate} className="px-3 py-1.5 text-xs font-bold bg-purple-600 text-white rounded hover:bg-purple-700">
                    Generate Image
                </button>
                {generated && (
                    <>
                        <button onClick={download} className="px-3 py-1.5 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-700">
                            Download PNG
                        </button>
                        <button onClick={uploadAndUse} className="px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded hover:bg-blue-700">
                            Upload & Use in Post
                        </button>
                    </>
                )}
            </div>
            <canvas ref={canvasRef} className="border rounded max-w-full" style={{ maxHeight: 400 }} />
        </div>
    );
}

// =========================================================
// Main Component
// =========================================================
export default function SocialMediaManager() {
    const [channels, setChannels] = useState([]);
    const [posts, setPosts] = useState([]);
    const [selectedChannel, setSelectedChannel] = useState('');
    const [messageText, setMessageText] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [parseMode, setParseMode] = useState('HTML');
    const [sending, setSending] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [tab, setTab] = useState('compose');

    // Question picker state
    const [searchExam, setSearchExam] = useState('');
    const [searchSection, setSearchSection] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [selectedQuestion, setSelectedQuestion] = useState(null);

    // Schedule state
    const [scheduleDate, setScheduleDate] = useState('');
    const [scheduleTime, setScheduleTime] = useState('09:00');

    // Bulk series state
    const [bulkQuestions, setBulkQuestions] = useState([]);
    const [bulkInterval, setBulkInterval] = useState(3);
    const [bulkStartTime, setBulkStartTime] = useState('');
    const [bulkScheduling, setBulkScheduling] = useState(false);

    useEffect(() => {
        fetch('/api/social/channels').then(r => r.json()).then(d => {
            setChannels(d.channels || []);
            if (d.channels?.length > 0) setSelectedChannel(d.channels[0].channel_id);
        });
        refreshPosts();
    }, []);

    const refreshPosts = () => {
        fetch('/api/social/posts').then(r => r.json()).then(d => setPosts(d.posts || []));
    };

    const handleSend = async () => {
        if (!messageText.trim() && !imageUrl.trim()) return;
        setSending(true);
        setFeedback(null);
        try {
            const res = await fetch('/api/social/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel_id: selectedChannel, content_text: messageText, image_url: imageUrl || undefined, parse_mode: parseMode }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', msg: `Sent! Message ID: ${data.message_id}` });
                setMessageText('');
                setImageUrl('');
                refreshPosts();
            } else {
                setFeedback({ type: 'error', msg: data.error || data.details || 'Failed' });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setSending(false);
        }
    };

    const handleSendPoll = async () => {
        if (!selectedQuestion) return;
        setSending(true);
        setFeedback(null);
        try {
            const q = selectedQuestion;
            const opts = (q.options || []).map(o => `${o.option_key}) ${stripLatex(o.opt_text)}`.substring(0, 100));
            const correctIdx = ['A', 'B', 'C', 'D'].indexOf(q.correct_option_label);
            const sj = q.solution_json || {};
            const explanation = sj.answer_outcome?.core_answer_basis || '';

            const res = await fetch('/api/social/send-poll', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channel_id: selectedChannel,
                    question_text: stripLatex(q.question_text).substring(0, 300),
                    options: opts,
                    correct_option_index: correctIdx >= 0 ? correctIdx : 0,
                    explanation: explanation.substring(0, 200),
                    question_id: q.question_id,
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', msg: `Poll sent! ID: ${data.message_id}` });
                refreshPosts();
            } else {
                setFeedback({ type: 'error', msg: data.error || 'Failed' });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setSending(false);
        }
    };

    const handleSchedule = async () => {
        if (!messageText.trim() || !scheduleDate) return;
        const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
        try {
            const res = await fetch('/api/social/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel_id: selectedChannel, content_text: messageText, image_url: imageUrl || undefined, scheduled_at: scheduledAt, parse_mode: parseMode }),
            });
            const data = await res.json();
            if (res.ok) {
                setFeedback({ type: 'success', msg: `Scheduled for ${scheduleDate} ${scheduleTime}` });
                setMessageText('');
                refreshPosts();
            } else {
                setFeedback({ type: 'error', msg: data.error });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        }
    };

    const handleProcessScheduled = async () => {
        const res = await fetch('/api/social/process-scheduled', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const data = await res.json();
        setFeedback({ type: 'success', msg: `Processed: ${data.sent || 0} sent, ${data.failed || 0} failed` });
        refreshPosts();
    };

    const searchQuestions = async (random = false) => {
        setSearchLoading(true);
        const params = new URLSearchParams();
        if (searchExam) params.set('exam', searchExam);
        if (searchSection) params.set('section', searchSection);
        if (random) params.set('random', 'true');
        params.set('limit', '10');
        const res = await fetch(`/api/social/search-questions?${params.toString()}`);
        const data = await res.json();
        setSearchResults(data.questions || []);
        setSearchLoading(false);
    };

    const handleBulkSchedule = async () => {
        if (bulkQuestions.length === 0 || !bulkStartTime) return;
        setBulkScheduling(true);
        let scheduled = 0;
        for (let i = 0; i < bulkQuestions.length; i++) {
            const q = bulkQuestions[i];
            const time = new Date(bulkStartTime);
            time.setHours(time.getHours() + i * bulkInterval);

            const questionPost = formatQuestionAsPost(q);
            const answerPost = formatAnswerReveal(q);

            // Schedule question
            await fetch('/api/social/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel_id: selectedChannel, content_text: questionPost, scheduled_at: time.toISOString(), parse_mode: 'HTML', question_ids: [q.question_id] }),
            });

            // Schedule answer (2 hours after question)
            const answerTime = new Date(time);
            answerTime.setHours(answerTime.getHours() + 2);
            await fetch('/api/social/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel_id: selectedChannel, content_text: answerPost, scheduled_at: answerTime.toISOString(), parse_mode: 'HTML', question_ids: [q.question_id] }),
            });

            scheduled++;
        }
        setFeedback({ type: 'success', msg: `Scheduled ${scheduled} questions (${scheduled * 2} posts total — Q + Answer)` });
        setBulkQuestions([]);
        setBulkScheduling(false);
        refreshPosts();
    };

    const handlePaste = async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = async () => {
                    const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: reader.result, role: 'social' }) });
                    const data = await res.json();
                    if (data.latexPath) setImageUrl(data.latexPath);
                };
                break;
            }
        }
    };

    const scheduledPosts = posts.filter(p => p.status === 'SCHEDULED');

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="container mx-auto px-4 py-8 max-w-5xl">
                <header className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Social Media Manager</h1>
                        <p className="text-gray-500 mt-1">Telegram channel management</p>
                    </div>
                    <div className="flex gap-2">
                        {scheduledPosts.length > 0 && (
                            <button onClick={handleProcessScheduled}
                                className="px-4 py-2 text-sm font-bold bg-amber-500 text-white rounded-lg hover:bg-amber-600">
                                ⏰ Send {scheduledPosts.length} Scheduled
                            </button>
                        )}
                    </div>
                </header>

                {feedback && (
                    <div className={`mb-4 px-4 py-2 rounded text-sm font-semibold ${feedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {feedback.msg}
                    </div>
                )}

                {/* Tabs */}
                <div className="flex gap-2 mb-6 flex-wrap">
                    {[
                        { key: 'compose', label: '✍️ Compose' },
                        { key: 'questions', label: '📝 Question Post' },
                        { key: 'poll', label: '📊 Poll' },
                        { key: 'bulk', label: '📅 Bulk Series' },
                        { key: 'image', label: '🖼️ Image Generator' },
                        { key: 'history', label: '📜 History' },
                    ].map(t => (
                        <button key={t.key} onClick={() => setTab(t.key)}
                            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* ===== COMPOSE ===== */}
                {tab === 'compose' && (
                    <div className="bg-white rounded-lg shadow border p-6 space-y-4">
                        <select value={selectedChannel} onChange={e => setSelectedChannel(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
                            {channels.map(c => <option key={c.channel_id} value={c.channel_id}>{c.platform} — {c.channel_name}</option>)}
                        </select>
                        <textarea rows={10} value={messageText} onChange={e => setMessageText(e.target.value)}
                            className="w-full border rounded-md px-3 py-2 text-sm font-mono resize-y" placeholder="Message (HTML: <b>bold</b> <i>italic</i>)" />
                        <div className="flex gap-2">
                            <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} onPaste={handlePaste}
                                className="flex-1 border rounded-md px-3 py-2 text-sm" placeholder="Image URL (or paste image)" />
                            {imageUrl && <button onClick={() => setImageUrl('')} className="text-xs text-red-500">Clear</button>}
                        </div>
                        {imageUrl && <img src={imageUrl} alt="" className="max-h-32 rounded border" />}
                        <div className="bg-gray-50 rounded p-3">
                            <div className="text-xs font-bold text-gray-400 mb-1">PREVIEW</div>
                            <div className="text-sm whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: messageText }} />
                        </div>
                        <div className="flex gap-3 items-center flex-wrap">
                            <button onClick={handleSend} disabled={sending || (!messageText.trim() && !imageUrl)}
                                className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50">
                                {sending ? 'Sending...' : '📤 Send Now'}
                            </button>
                            <div className="flex gap-2 items-center">
                                <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="border rounded px-2 py-1 text-sm" />
                                <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="border rounded px-2 py-1 text-sm" />
                                <button onClick={handleSchedule} disabled={!messageText.trim() || !scheduleDate}
                                    className="px-4 py-2 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 disabled:opacity-50 text-sm">
                                    ⏰ Schedule
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ===== QUESTION POST ===== */}
                {tab === 'questions' && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-lg shadow border p-4">
                            <h3 className="text-sm font-bold text-gray-700 mb-3">Find a Question</h3>
                            <div className="flex gap-2 flex-wrap">
                                <input value={searchExam} onChange={e => setSearchExam(e.target.value)} placeholder="Exam (e.g., SSC CGL)" className="border rounded px-3 py-1.5 text-sm" />
                                <input value={searchSection} onChange={e => setSearchSection(e.target.value)} placeholder="Section (e.g., QA)" className="border rounded px-3 py-1.5 text-sm" />
                                <button onClick={() => searchQuestions(false)} disabled={searchLoading} className="px-3 py-1.5 text-sm font-bold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">Search</button>
                                <button onClick={() => searchQuestions(true)} disabled={searchLoading} className="px-3 py-1.5 text-sm font-bold bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">🎲 Random</button>
                            </div>
                        </div>

                        {searchResults.length > 0 && (
                            <div className="bg-white rounded-lg shadow border divide-y">
                                {searchResults.map(q => (
                                    <div key={q.question_id} className={`p-3 cursor-pointer hover:bg-blue-50 ${selectedQuestion?.question_id === q.question_id ? 'bg-blue-100' : ''}`}
                                        onClick={() => { setSelectedQuestion(q); setMessageText(formatQuestionAsPost(q)); }}>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{q.section_code}</span>
                                            <span className="text-xs text-gray-400">{q.exam_name}</span>
                                            <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{DIFF_MAP[q.difficulty] || '?'}</span>
                                            <span className="text-xs font-bold text-green-600">Ans: {q.correct_option_label}</span>
                                        </div>
                                        <div className="text-sm text-gray-800 line-clamp-2">{q.question_text}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {selectedQuestion && (
                            <div className="bg-white rounded-lg shadow border p-4 space-y-3">
                                <h3 className="text-sm font-bold text-gray-700">Post Preview</h3>
                                <div className="bg-gray-50 rounded p-3 text-sm whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: messageText }} />
                                <div className="flex gap-2">
                                    <button onClick={handleSend} disabled={sending}
                                        className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
                                        📤 Send as Post
                                    </button>
                                    <button onClick={handleSendPoll} disabled={sending}
                                        className="px-4 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm">
                                        📊 Send as Poll
                                    </button>
                                    <button onClick={() => { setMessageText(formatAnswerReveal(selectedQuestion)); }}
                                        className="px-4 py-2 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 text-sm">
                                        ✅ Load Answer Reveal
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ===== POLL ===== */}
                {tab === 'poll' && (
                    <div className="bg-white rounded-lg shadow border p-6 space-y-4">
                        <p className="text-sm text-gray-500">Search a question in the "Question Post" tab, then click "Send as Poll".</p>
                        {selectedQuestion && (
                            <div className="space-y-3">
                                <div className="text-sm font-bold text-gray-700">Selected: {selectedQuestion.question_text?.substring(0, 100)}...</div>
                                <button onClick={handleSendPoll} disabled={sending}
                                    className="px-6 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50">
                                    {sending ? 'Sending...' : '📊 Send as Telegram Poll'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ===== BULK SERIES ===== */}
                {tab === 'bulk' && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-lg shadow border p-4">
                            <h3 className="text-sm font-bold text-gray-700 mb-3">Build Question Series</h3>
                            <div className="flex gap-2 flex-wrap mb-3">
                                <input value={searchExam} onChange={e => setSearchExam(e.target.value)} placeholder="Exam" className="border rounded px-3 py-1.5 text-sm" />
                                <input value={searchSection} onChange={e => setSearchSection(e.target.value)} placeholder="Section" className="border rounded px-3 py-1.5 text-sm" />
                                <button onClick={() => searchQuestions(true)} disabled={searchLoading}
                                    className="px-3 py-1.5 text-sm font-bold bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">
                                    🎲 Get Random Questions
                                </button>
                            </div>

                            {searchResults.length > 0 && (
                                <div className="divide-y border rounded mb-3 max-h-64 overflow-y-auto">
                                    {searchResults.map(q => {
                                        const added = bulkQuestions.some(bq => bq.question_id === q.question_id);
                                        return (
                                            <div key={q.question_id} className="p-2 flex items-center justify-between text-sm">
                                                <div className="flex-1 line-clamp-1 text-gray-700">{q.section_code} — {q.question_text?.substring(0, 80)}</div>
                                                <button onClick={() => !added && setBulkQuestions(prev => [...prev, q])} disabled={added}
                                                    className={`px-2 py-0.5 text-xs font-bold rounded ${added ? 'bg-green-100 text-green-600' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                                                    {added ? 'Added' : '+ Add'}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {bulkQuestions.length > 0 && (
                                <div className="border rounded p-3 bg-blue-50">
                                    <div className="text-sm font-bold text-blue-800 mb-2">Series: {bulkQuestions.length} questions</div>
                                    {bulkQuestions.map((q, i) => (
                                        <div key={q.question_id} className="flex items-center gap-2 text-xs text-gray-600 py-0.5">
                                            <span className="font-bold">#{i + 1}</span>
                                            <span className="flex-1 line-clamp-1">{q.section_code} — {q.question_text?.substring(0, 60)}</span>
                                            <button onClick={() => setBulkQuestions(prev => prev.filter(bq => bq.question_id !== q.question_id))} className="text-red-500 text-xs">Remove</button>
                                        </div>
                                    ))}
                                    <div className="flex gap-2 items-center mt-3">
                                        <label className="text-xs font-bold text-gray-600">Start:</label>
                                        <input type="datetime-local" value={bulkStartTime} onChange={e => setBulkStartTime(e.target.value)} className="border rounded px-2 py-1 text-sm" />
                                        <label className="text-xs font-bold text-gray-600">Every:</label>
                                        <select value={bulkInterval} onChange={e => setBulkInterval(parseInt(e.target.value))} className="border rounded px-2 py-1 text-sm">
                                            <option value={1}>1 hour</option>
                                            <option value={2}>2 hours</option>
                                            <option value={3}>3 hours</option>
                                            <option value={6}>6 hours</option>
                                            <option value={12}>12 hours</option>
                                            <option value={24}>24 hours</option>
                                        </select>
                                        <button onClick={handleBulkSchedule} disabled={bulkScheduling || !bulkStartTime}
                                            className="px-4 py-1.5 bg-amber-500 text-white font-bold rounded hover:bg-amber-600 disabled:opacity-50 text-sm">
                                            {bulkScheduling ? 'Scheduling...' : `📅 Schedule ${bulkQuestions.length} Q + Answers`}
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">Each question gets a Q post + answer reveal 2 hours later.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ===== IMAGE GENERATOR ===== */}
                {tab === 'image' && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-lg shadow border p-4">
                            <h3 className="text-sm font-bold text-gray-700 mb-3">Generate Branded Quiz Image</h3>
                            <p className="text-xs text-gray-500 mb-3">Search a question first, then generate an image.</p>
                            <div className="flex gap-2 flex-wrap mb-3">
                                <input value={searchExam} onChange={e => setSearchExam(e.target.value)} placeholder="Exam" className="border rounded px-3 py-1.5 text-sm" />
                                <input value={searchSection} onChange={e => setSearchSection(e.target.value)} placeholder="Section" className="border rounded px-3 py-1.5 text-sm" />
                                <button onClick={() => searchQuestions(true)} disabled={searchLoading}
                                    className="px-3 py-1.5 text-sm font-bold bg-purple-600 text-white rounded hover:bg-purple-700">🎲 Random</button>
                            </div>

                            {searchResults.length > 0 && (
                                <div className="divide-y border rounded mb-3 max-h-48 overflow-y-auto">
                                    {searchResults.map(q => (
                                        <div key={q.question_id} className={`p-2 cursor-pointer hover:bg-purple-50 text-sm ${selectedQuestion?.question_id === q.question_id ? 'bg-purple-100' : ''}`}
                                            onClick={() => setSelectedQuestion(q)}>
                                            <span className="text-xs bg-indigo-50 text-indigo-600 px-1 py-0.5 rounded mr-2">{q.section_code}</span>
                                            {q.question_text?.substring(0, 80)}...
                                        </div>
                                    ))}
                                </div>
                            )}

                            {selectedQuestion && (
                                <QuestionImageGenerator
                                    question={selectedQuestion}
                                    onGenerated={(url) => { setImageUrl(url); setTab('compose'); setFeedback({ type: 'success', msg: 'Image uploaded! Switch to Compose to send.' }); }}
                                />
                            )}
                        </div>
                    </div>
                )}

                {/* ===== HISTORY ===== */}
                {tab === 'history' && (
                    <div className="bg-white rounded-lg shadow border overflow-hidden">
                        <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                            <span className="text-sm font-bold text-gray-700">Post History</span>
                            <button onClick={refreshPosts} className="text-xs text-blue-600 hover:underline">Refresh</button>
                        </div>
                        {posts.length === 0 ? (
                            <div className="p-8 text-center text-gray-400">No posts yet.</div>
                        ) : (
                            <div className="divide-y max-h-[600px] overflow-y-auto">
                                {posts.map(p => (
                                    <div key={p.post_id} className="p-3 hover:bg-gray-50">
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${p.status === 'SENT' ? 'bg-green-100 text-green-700' : p.status === 'SCHEDULED' ? 'bg-amber-100 text-amber-700' : p.status === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                                                    {p.status}
                                                </span>
                                                {p.channel_name && <span className="text-xs text-gray-500">{p.channel_name}</span>}
                                                {p.scheduled_at && p.status === 'SCHEDULED' && (
                                                    <span className="text-xs text-amber-600">⏰ {new Date(p.scheduled_at).toLocaleString('en-IN')}</span>
                                                )}
                                            </div>
                                            <span className="text-xs text-gray-400">
                                                {p.sent_at ? new Date(p.sent_at).toLocaleString('en-IN') : p.created_at ? new Date(p.created_at).toLocaleString('en-IN') : ''}
                                            </span>
                                        </div>
                                        <div className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-3">{p.content_text}</div>
                                        {p.image_url && <img src={p.image_url} alt="" className="mt-2 max-h-20 rounded border" />}
                                        {p.error_message && <div className="text-xs text-red-500 mt-1">{p.error_message}</div>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
