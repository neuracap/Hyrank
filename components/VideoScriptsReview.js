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
    // Local edits of the romanized (Latin) copy used for NotebookLM: id -> text
    const [latinDrafts, setLatinDrafts] = useState({});
    // Reviewer notes/references appended to the prompt on Regenerate: id -> text
    const [regenNotes, setRegenNotes] = useState({});
    // Which cards have the notes box expanded: id -> bool
    const [notesOpen, setNotesOpen] = useState({});
    // Production helpers (post-approval): clipboard feedback, ElevenLabs config
    const [copiedId, setCopiedId] = useState(null);
    const [elevenEnabled, setElevenEnabled] = useState(false);
    const [voices, setVoices] = useState([]);
    const [voiceSel, setVoiceSel] = useState({}); // id -> voice key

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
            setElevenEnabled(!!j.elevenlabs_enabled);
            setVoices(j.voices || []);
            // Seed drafts from the saved transcript
            const seeded = {};
            const seededLatin = {};
            for (const r of j.rows) {
                seeded[r.video_script_id] = r.transcript || '';
                seededLatin[r.video_script_id] = r.transcript_latin || '';
            }
            setDrafts(seeded);
            setLatinDrafts(seededLatin);
        } catch (e) { setErr(e.message); }
        finally { setLoading(false); }
    }, [filterStatus, search]);

    useEffect(() => { load(); }, [load]);

    const setDraft = (id, value) => setDrafts(prev => ({ ...prev, [id]: value }));
    const setLatinDraft = (id, value) => setLatinDrafts(prev => ({ ...prev, [id]: value }));

    const isDirty = (row) =>
        (drafts[row.video_script_id] ?? '') !== (row.transcript ?? '') ||
        (latinDrafts[row.video_script_id] ?? '') !== (row.transcript_latin ?? '');

    const save = async (row, status) => {
        const id = row.video_script_id;
        setBusyKey(`${status || 'save'}-${id}`);
        setErr('');
        try {
            const body = { transcript: drafts[id] ?? '', transcript_latin: latinDrafts[id] ?? '' };
            if (status) body.status = status;
            const res = await fetch(`/api/video-scripts/${id}/save`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Save failed');
            // Patch in place so the reviewer sees the new status immediately —
            // the card stays visible (even if it left this filter tab) until the
            // next reload. Adjust the tab counts locally to match.
            setCounts(prev => {
                if (!status || status === row.status) return prev;
                const next = { ...prev };
                next[row.status] = Math.max(0, (next[row.status] || 0) - 1);
                next[j.row.status] = (next[j.row.status] || 0) + 1;
                return next;
            });
            setRows(prev => prev.map(r => r.video_script_id === id
                ? { ...r, transcript: j.row.transcript, transcript_latin: j.row.transcript_latin, status: j.row.status, prod_stage: j.row.prod_stage, reviewed_at: j.row.reviewed_at }
                : r));
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    // Copy for NotebookLM: prefer the Latin (romanized) copy — NotebookLM's burned-in
    // captions can't render Devanagari. Falls back to the Devanagari transcript.
    const copyScript = async (row) => {
        const id = row.video_script_id;
        const latin = (latinDrafts[id] ?? row.transcript_latin ?? '').trim();
        try {
            await navigator.clipboard.writeText(latin || drafts[id] || row.transcript || '');
            setCopiedId(id);
            setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), 2000);
        } catch {
            setErr('Clipboard copy failed — select the text and copy manually.');
        }
    };

    // Generate/refresh the romanized copy from the current Devanagari transcript.
    const transliterate = async (row) => {
        const id = row.video_script_id;
        setBusyKey(`latin-${id}`);
        setErr('');
        try {
            const res = await fetch(`/api/video-scripts/${id}/transliterate`, { method: 'POST' });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Transliteration failed');
            setRows(prev => prev.map(r => r.video_script_id === id
                ? { ...r, transcript_latin: j.row.transcript_latin } : r));
            setLatinDraft(id, j.row.transcript_latin || '');
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    // Patch production fields (stage transitions) on an approved script.
    const prodPatch = async (row, body, busyLabel) => {
        const id = row.video_script_id;
        setBusyKey(`${busyLabel}-${id}`);
        setErr('');
        try {
            const res = await fetch(`/api/video-production/${id}/update`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Update failed');
            setRows(prev => prev.map(r => r.video_script_id === id ? { ...r, ...j.row } : r));
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    // Send the transcript to ElevenLabs with the chosen voice.
    const generateAudio = async (row) => {
        const id = row.video_script_id;
        setBusyKey(`gen-audio-${id}`);
        setErr('');
        try {
            const res = await fetch(`/api/video-production/${id}/audio`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voice: voiceSel[id] || voices[0]?.key }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Audio generation failed');
            setRows(prev => prev.map(r => r.video_script_id === id ? { ...r, ...j.row } : r));
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const setNote = (id, value) => setRegenNotes(prev => ({ ...prev, [id]: value }));
    const toggleNotes = (id) => setNotesOpen(prev => ({ ...prev, [id]: !prev[id] }));
    // Drop the current draft into the notes box so the reviewer can tell the model to improve on it.
    const insertCurrentScript = (row) => {
        const id = row.video_script_id;
        const current = drafts[id] ?? '';
        const existing = regenNotes[id] ?? '';
        const block = `Here is the current script — keep what works and improve on it:\n"""\n${current}\n"""`;
        setNote(id, existing ? `${existing}\n\n${block}` : block);
        setNotesOpen(prev => ({ ...prev, [id]: true }));
    };

    const regenerate = async (row) => {
        const id = row.video_script_id;
        const comments = (regenNotes[id] ?? '').trim();
        const msg = comments
            ? `Regenerate "${row.word}" using your notes? This overwrites the current text.`
            : `Regenerate the transcript for "${row.word}"? This overwrites the current text.`;
        if (!confirm(msg)) return;
        setBusyKey(`regen-${id}`);
        setErr('');
        try {
            const res = await fetch(`/api/video-scripts/${id}/generate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ comments }),
            });
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
                                    {row.prod_stage && row.prod_stage !== 'NONE' && (
                                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-700">
                                            {row.prod_stage === 'VIDEO' ? 'VIDEO GENERATING' : row.prod_stage}
                                        </span>
                                    )}
                                    <button onClick={() => copyScript(row)}
                                        title="Copy the transcript to paste into NotebookLM as a source"
                                        className={`px-2 py-0.5 text-[11px] font-bold rounded border
                                            ${copiedId === id
                                                ? 'border-green-300 text-green-700 bg-green-50'
                                                : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                                        {copiedId === id ? 'Copied ✓' : '⧉ Copy for NotebookLM'}
                                    </button>
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

                            <div className="mt-2">
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                                        Hinglish in Latin script — sent to NotebookLM (captions can’t render Devanagari)
                                    </label>
                                    <button
                                        onClick={() => transliterate(row)}
                                        disabled={busyKey === `latin-${id}`}
                                        className="px-2.5 py-1 text-[11px] font-bold rounded border border-teal-300 text-teal-700 bg-teal-50 hover:bg-teal-100 disabled:opacity-50">
                                        {busyKey === `latin-${id}` ? 'Transliterating…' : ((latinDrafts[id] || '').trim() ? '↻ Re-transliterate' : 'Aa Transliterate')}
                                    </button>
                                </div>
                                <textarea
                                    value={latinDrafts[id] ?? ''}
                                    onChange={e => setLatinDraft(id, e.target.value)}
                                    rows={(latinDrafts[id] || '').trim() ? 8 : 2}
                                    placeholder="Empty — click Transliterate to generate the romanized copy from the script above (auto-generated during video creation if left empty)."
                                    className="w-full border border-teal-200 bg-teal-50/30 rounded p-3 text-sm font-normal leading-relaxed
                                        focus:outline-none focus:ring-2 focus:ring-teal-400"
                                    style={{ resize: 'vertical' }}
                                />
                            </div>

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
                                <button
                                    onClick={() => toggleNotes(id)}
                                    className={`px-2.5 py-1.5 text-xs font-bold rounded border
                                        ${(regenNotes[id] || '').trim()
                                            ? 'border-purple-300 text-purple-700 bg-purple-50'
                                            : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                                    {notesOpen[id] ? 'Hide notes' : ((regenNotes[id] || '').trim() ? 'Notes ●' : '＋ Notes')}
                                </button>
                                {row.reviewed_at && (
                                    <span className="text-[11px] text-gray-400 ml-auto">
                                        reviewed {new Date(row.reviewed_at).toLocaleString()}
                                    </span>
                                )}
                            </div>

                            {notesOpen[id] && (
                                <div className="mt-2 border-t border-dashed border-gray-200 pt-2">
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                                            Regenerate notes / references (added to the prompt)
                                        </label>
                                        <button
                                            onClick={() => insertCurrentScript(row)}
                                            className="text-[11px] text-blue-600 hover:underline font-semibold">
                                            + insert current script
                                        </button>
                                    </div>
                                    <textarea
                                        value={regenNotes[id] ?? ''}
                                        onChange={e => setNote(id, e.target.value)}
                                        rows={4}
                                        placeholder="e.g. Make the hook a Bollywood villain instead. Keep the memory trick. Use a shorter closing. (You can also paste a reference script here.)"
                                        className="w-full border border-gray-300 rounded p-2 text-sm
                                            focus:outline-none focus:ring-2 focus:ring-purple-400"
                                        style={{ resize: 'vertical' }}
                                    />
                                    <p className="text-[11px] text-gray-400 mt-1">
                                        These notes are appended to the base prompt for this one regeneration (not saved). Leave empty to regenerate with the base prompt only.
                                    </p>
                                </div>
                            )}

                            {row.prod_stage && row.prod_stage !== 'NONE' && (
                                <div className="mt-3 border-t border-gray-200 pt-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mr-1">Production</span>

                                        {row.prod_stage === 'QUEUED' && (
                                            <button
                                                onClick={() => prodPatch(row, { prod_stage: 'VIDEO' }, 'vid')}
                                                disabled={busyKey === `vid-${id}`}
                                                className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700 disabled:opacity-50">
                                                {busyKey === `vid-${id}` ? '…' : '🎬 Video generating'}
                                            </button>
                                        )}
                                        {row.prod_stage === 'VIDEO' && (
                                            <button
                                                onClick={() => prodPatch(row, { prod_stage: 'EDIT' }, 'vid')}
                                                disabled={busyKey === `vid-${id}`}
                                                className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded hover:bg-green-700 disabled:opacity-50">
                                                {busyKey === `vid-${id}` ? '…' : '✓ Video generated'}
                                            </button>
                                        )}
                                        {['EDIT', 'READY', 'PUBLISHED'].includes(row.prod_stage) && (
                                            <span className="text-xs text-green-700 font-semibold">Video generated ✓</span>
                                        )}

                                        <span className="text-gray-300">|</span>

                                        <select
                                            value={voiceSel[id] || voices[0]?.key || ''}
                                            onChange={e => setVoiceSel(prev => ({ ...prev, [id]: e.target.value }))}
                                            className="px-2 py-1.5 border border-gray-300 rounded text-xs">
                                            {voices.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                                        </select>
                                        <button
                                            onClick={() => generateAudio(row)}
                                            disabled={!elevenEnabled || busyKey === `gen-audio-${id}`}
                                            title={!elevenEnabled ? 'ELEVENLABS_API_KEY not set' : 'Generate voiceover with ElevenLabs'}
                                            className="px-3 py-1.5 bg-purple-600 text-white text-xs font-bold rounded hover:bg-purple-700 disabled:opacity-40">
                                            {busyKey === `gen-audio-${id}` ? 'Generating…' : '🔊 Generate audio'}
                                        </button>

                                        {row.audio_status === 'DONE' && row.audio_url && (
                                            <span className="text-xs text-green-700 font-semibold">
                                                Audio ✓ {row.audio_voice ? `(${row.audio_voice})` : ''}{' '}
                                                <a href={row.audio_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">▶ play</a>
                                            </span>
                                        )}
                                        {row.audio_status === 'FAILED' && (
                                            <span className="text-xs text-red-600" title={row.audio_error || ''}>Audio failed ✕</span>
                                        )}
                                    </div>
                                    {!elevenEnabled && (
                                        <p className="text-[11px] text-amber-600 mt-1">
                                            ElevenLabs isn’t configured (ELEVENLABS_API_KEY) — audio generation disabled.
                                        </p>
                                    )}
                                </div>
                            )}
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
