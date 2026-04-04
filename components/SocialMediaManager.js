'use client';

import { useState, useEffect } from 'react';

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

    useEffect(() => {
        fetch('/api/social/channels').then(r => r.json()).then(d => {
            setChannels(d.channels || []);
            if (d.channels?.length > 0) setSelectedChannel(d.channels[0].channel_id);
        });
        fetch('/api/social/posts').then(r => r.json()).then(d => setPosts(d.posts || []));
    }, []);

    const handleSend = async () => {
        if (!messageText.trim() && !imageUrl.trim()) return;
        setSending(true);
        setFeedback(null);
        try {
            const res = await fetch('/api/social/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channel_id: selectedChannel || undefined,
                    content_text: messageText,
                    image_url: imageUrl || undefined,
                    parse_mode: parseMode,
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setFeedback({ type: 'success', msg: `Sent! Message ID: ${data.message_id}` });
                setMessageText('');
                setImageUrl('');
                // Refresh posts
                const postsRes = await fetch('/api/social/posts');
                const postsData = await postsRes.json();
                setPosts(postsData.posts || []);
            } else {
                setFeedback({ type: 'error', msg: data.error || data.details || 'Failed to send' });
            }
        } catch (e) {
            setFeedback({ type: 'error', msg: e.message });
        } finally {
            setSending(false);
        }
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
                    try {
                        const res = await fetch('/api/upload', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ data: reader.result, role: 'social' }),
                        });
                        const data = await res.json();
                        if (data.latexPath) setImageUrl(data.latexPath);
                    } catch (err) {
                        console.error('Upload error:', err);
                    }
                };
                break;
            }
        }
    };

    const TEMPLATES = [
        {
            name: 'Daily Quiz',
            text: `📝 <b>Daily Quiz — {date}</b>\n\n<b>Q. {question}</b>\n\nA) {optA}\nB) {optB}\nC) {optC}\nD) {optD}\n\n⏰ Answer in 60 seconds!\n\n👉 @hyrank_quiz`,
        },
        {
            name: 'Answer Reveal',
            text: `✅ <b>Answer: {answer}</b>\n\n💡 <b>Explanation:</b>\n{explanation}\n\n📊 Difficulty: {difficulty}\n\n👉 @hyrank_quiz`,
        },
        {
            name: 'Tip of the Day',
            text: `💡 <b>Exam Tip of the Day</b>\n\n{tip}\n\n📌 Save this for revision!\n\n👉 @hyrank_quiz`,
        },
        {
            name: 'Announcement',
            text: `📢 <b>{title}</b>\n\n{body}\n\n👉 @hyrank_quiz`,
        },
    ];

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="container mx-auto px-4 py-8 max-w-4xl">
                <header className="mb-6">
                    <h1 className="text-3xl font-bold text-gray-900">Social Media Manager</h1>
                    <p className="text-gray-500 mt-1">Send messages to Telegram channels</p>
                </header>

                {/* Tabs */}
                <div className="flex gap-2 mb-6">
                    {['compose', 'templates', 'history'].map(t => (
                        <button key={t} onClick={() => setTab(t)}
                            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Compose Tab */}
                {tab === 'compose' && (
                    <div className="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-4">
                        {/* Channel selector */}
                        <div>
                            <label className="text-sm font-semibold text-gray-700 block mb-1">Channel</label>
                            <select value={selectedChannel} onChange={e => setSelectedChannel(e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
                                {channels.map(c => (
                                    <option key={c.channel_id} value={c.channel_id}>
                                        {c.platform} — {c.channel_name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Message */}
                        <div>
                            <label className="text-sm font-semibold text-gray-700 block mb-1">Message (HTML supported)</label>
                            <textarea
                                rows={10}
                                value={messageText}
                                onChange={e => setMessageText(e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono resize-y"
                                placeholder="Type your message... Use <b>bold</b>, <i>italic</i>, <code>code</code>"
                            />
                        </div>

                        {/* Parse mode */}
                        <div className="flex items-center gap-4">
                            <label className="text-sm font-semibold text-gray-700">Format:</label>
                            {['HTML', 'Markdown', 'MarkdownV2'].map(m => (
                                <label key={m} className="flex items-center gap-1 text-sm">
                                    <input type="radio" name="parseMode" value={m} checked={parseMode === m}
                                        onChange={() => setParseMode(m)} />
                                    {m}
                                </label>
                            ))}
                        </div>

                        {/* Image */}
                        <div>
                            <label className="text-sm font-semibold text-gray-700 block mb-1">Image (optional)</label>
                            <div className="flex gap-2">
                                <input
                                    value={imageUrl}
                                    onChange={e => setImageUrl(e.target.value)}
                                    className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm"
                                    placeholder="Paste image URL or paste image below..."
                                    onPaste={handlePaste}
                                />
                                {imageUrl && (
                                    <button onClick={() => setImageUrl('')} className="text-xs text-red-500 hover:text-red-700">Clear</button>
                                )}
                            </div>
                            {imageUrl && (
                                <img src={imageUrl} alt="Preview" className="mt-2 max-h-40 rounded border border-gray-200" />
                            )}
                        </div>

                        {/* Preview */}
                        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                            <div className="text-xs font-bold text-gray-400 uppercase mb-2">Preview</div>
                            <div className="text-sm text-gray-800 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: messageText }} />
                        </div>

                        {/* Send */}
                        <div className="flex items-center gap-3">
                            <button onClick={handleSend} disabled={sending || (!messageText.trim() && !imageUrl.trim())}
                                className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                                {sending ? 'Sending...' : '📤 Send Now'}
                            </button>
                            {feedback && (
                                <span className={`text-sm font-semibold ${feedback.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                                    {feedback.msg}
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* Templates Tab */}
                {tab === 'templates' && (
                    <div className="space-y-4">
                        {TEMPLATES.map((t, i) => (
                            <div key={i} className="bg-white rounded-lg shadow border border-gray-200 p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-sm font-bold text-gray-700">{t.name}</h3>
                                    <button onClick={() => { setMessageText(t.text); setTab('compose'); }}
                                        className="px-3 py-1 text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100">
                                        Use Template
                                    </button>
                                </div>
                                <pre className="text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 p-3 rounded">{t.text}</pre>
                            </div>
                        ))}
                    </div>
                )}

                {/* History Tab */}
                {tab === 'history' && (
                    <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                        {posts.length === 0 ? (
                            <div className="p-8 text-center text-gray-400">No posts sent yet.</div>
                        ) : (
                            <div className="divide-y divide-gray-100">
                                {posts.map(p => (
                                    <div key={p.post_id} className="p-4 hover:bg-gray-50">
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${p.status === 'SENT' ? 'bg-green-100 text-green-700' : p.status === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                                                    {p.status}
                                                </span>
                                                <span className="text-xs text-gray-500">{p.channel_name || 'Default'}</span>
                                                <span className="text-xs text-gray-400">{p.platform}</span>
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
