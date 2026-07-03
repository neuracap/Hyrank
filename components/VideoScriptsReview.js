'use client';

import { useState, useEffect, useCallback } from 'react';

const STATUS_TABS = ['GENERATED', 'EDITED', 'APPROVED', 'FAILED'];

const STATUS_STYLE = {
    GENERATED: 'bg-blue-100 text-blue-700',
    EDITED: 'bg-amber-100 text-amber-700',
    APPROVED: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700',
};

export default function VideoScriptsReview() {
    const [filterStatus, setFilterStatus] = useState('GENERATED');
    const [search, setSearch] = useState('');
    const [rows, setRows] = useState([]);
    const [counts, setCounts] = useState({});
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [busyKey, setBusyKey] = useState(null);
    // Local edits: id -> draft transcript text
    const [drafts, setDrafts] = useState({});

    const load = useCallback(async () => {
        setLoading(true);
        setErr('');
        try {
            const qs = new URLSearchParams();
            if (filterStatus) qs.set('status', filterStatus);
            if (search.trim()) qs.set('search', search.trim());
            qs.set('limit', '500');
            const res = await fetch(`/api/video-scripts/list?${qs.toString()}`);
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Failed to load');
            setRows(j.rows);
            setCounts(j.counts_by_status || {});
            setTotal(j.total);
            // Seed drafts from the saved transcript
            const seeded = {};
            for (const r of j.rows) seeded[r.video_script_id] = r.transcript || '';
            setDrafts(seeded);
        } catch (e) { setErr(e.message); }
        finally { setLoading(false); }
    }, [filterStatus, search]);

    useEffect(() => { load(); }, [load]);

    const setDraft = (id, value) => setDrafts(prev => ({ ...prev, [id]: value }));

    const isDirty = (row) => (drafts[row.video_script_id] ?? '') !== (row.transcript ?? '');

    const save = async (row, status) => {
        const id = row.video_script_id;
        setBusyKey(`${status || 'save'}-${id}`);
        setErr('');
        try {
            const body = { transcript: drafts[id] ?? '' };
            if (status) body.status = status;
            const res = await fetch(`/api/video-scripts/${id}/save`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Save failed');
            // Reflect new status/transcript locally; if it no longer matches the filter, drop it on reload
            if (status && status !== filterStatus) {
                await load();
            } else {
                setRows(prev => prev.map(r => r.video_script_id === id
                    ? { ...r, transcript: j.row.transcript, status: j.row.status, reviewed_at: j.row.reviewed_at }
                    : r));
            }
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const regenerate = async (row) => {
        if (!confirm(`Regenerate the transcript for "${row.word}"? This overwrites the current text.`)) return;
        const id = row.video_script_id;
        setBusyKey(`regen-${id}`);
        setErr('');
        try {
            const res = await fetch(`/api/video-scripts/${id}/generate`, { method: 'POST' });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Regenerate failed');
            setRows(prev => prev.map(r => r.video_script_id === id
                ? { ...r, transcript: j.row.transcript, status: j.row.status } : r));
            setDraft(id, j.row.transcript || '');
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    return (
        <div className="px-4 py-4 max-w-[1100px] mx-auto">
            <header className="mb-4 border-b pb-3">
                <h1 className="text-2xl font-bold text-gray-900">Video Scripts — Review</h1>
                <p className="text-gray-500 text-sm mt-0.5">
                    AI-generated Hinglish voiceover transcripts for vocab Reels/Shorts. Edit, approve, then hand off for video production.
                </p>
            </header>

            {err && <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{err}</div>}

            <div className="flex gap-2 mb-3 border-b pb-2 flex-wrap items-center">
                {STATUS_TABS.map(s => (
                    <button key={s} onClick={() => setFilterStatus(s)}
                        className={`px-3 py-1.5 rounded text-xs font-bold
                            ${filterStatus === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        {s} <span className={`ml-1 font-normal ${filterStatus === s ? 'text-blue-100' : 'text-gray-500'}`}>
                            ({counts[s] || 0})</span>
                    </button>
                ))}
                <div className="flex-1" />
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search word or transcript…"
                    className="px-3 py-1.5 border border-gray-300 rounded text-sm w-64"
                />
                <button onClick={load}
                    className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50">
                    Refresh
                </button>
            </div>

            <div className="text-xs text-gray-500 mb-3">
                {loading ? 'Loading…' : `${total} script${total === 1 ? '' : 's'} in "${filterStatus}"`}
            </div>

            <div className="space-y-4">
                {rows.map(row => {
                    const id = row.video_script_id;
                    const dirty = isDirty(row);
                    return (
                        <div key={id} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-400 text-xs font-mono">#{row.word_sno ?? '—'}</span>
                                    <h2 className="text-lg font-bold text-gray-900">{row.word}</h2>
                                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${STATUS_STYLE[row.status] || 'bg-gray-100 text-gray-600'}`}>
                                        {row.status}
                                    </span>
                                    {dirty && <span className="text-[11px] text-amber-600 font-semibold">● unsaved</span>}
                                </div>
                                <div className="text-[11px] text-gray-400">{row.model}</div>
                            </div>

                            {row.status === 'FAILED' && row.gen_error && (
                                <div className="mb-2 p-2 bg-red-50 text-red-700 border border-red-200 rounded text-xs">
                                    Generation failed: {row.gen_error}
                                </div>
                            )}

                            <textarea
                                value={drafts[id] ?? ''}
                                onChange={e => setDraft(id, e.target.value)}
                                rows={10}
                                placeholder={row.status === 'FAILED' ? 'No transcript — regenerate to produce one.' : ''}
                                className="w-full border border-gray-300 rounded p-3 text-sm font-normal leading-relaxed
                                    focus:outline-none focus:ring-2 focus:ring-blue-400"
                                style={{ resize: 'vertical' }}
                            />

                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                                <button
                                    onClick={() => save(row, 'EDITED')}
                                    disabled={busyKey === `EDITED-${id}`}
                                    className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 disabled:opacity-50">
                                    {busyKey === `EDITED-${id}` ? 'Saving…' : 'Save edit'}
                                </button>
                                <button
                                    onClick={() => save(row, 'APPROVED')}
                                    disabled={busyKey === `APPROVED-${id}`}
                                    className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded hover:bg-green-700 disabled:opacity-50">
                                    {busyKey === `APPROVED-${id}` ? 'Saving…' : 'Save & approve'}
                                </button>
                                <button
                                    onClick={() => regenerate(row)}
                                    disabled={busyKey === `regen-${id}`}
                                    className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-bold rounded hover:bg-gray-50 disabled:opacity-50">
                                    {busyKey === `regen-${id}` ? 'Regenerating…' : 'Regenerate'}
                                </button>
                                {row.reviewed_at && (
                                    <span className="text-[11px] text-gray-400 ml-auto">
                                        reviewed {new Date(row.reviewed_at).toLocaleString()}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}

                {!loading && rows.length === 0 && (
                    <div className="text-center text-gray-400 py-16 text-sm">
                        No scripts in this bucket. Run <code className="bg-gray-100 px-1 rounded">node scripts/generate_video_scripts.js --apply</code> to generate transcripts.
                    </div>
                )}
            </div>
        </div>
    );
}
