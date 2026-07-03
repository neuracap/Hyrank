'use client';

import { useState, useEffect, useCallback } from 'react';

// Ordered pipeline stages. Each card advances QUEUED → … → PUBLISHED.
const STAGES = ['QUEUED', 'VIDEO', 'EDIT', 'READY', 'PUBLISHED'];
const STAGE_LABEL = {
    QUEUED: 'Queued',
    VIDEO: 'Video (NotebookLM)',
    EDIT: 'Edit / Combine',
    READY: 'Ready',
    PUBLISHED: 'Published',
};
const STAGE_HINT = {
    QUEUED: 'Approved scripts waiting to start. Advance to Video when you begin the NotebookLM generation.',
    VIDEO: 'Generate the video in NotebookLM (paste the script as a source), download it, and paste the link. Generate/attach audio here too.',
    EDIT: 'Combine video + audio and edit in CapCut (recommended), Canva, or InShot. Paste the final rendered link.',
    READY: 'Final video is done. Add the publish target, then mark Published when it goes live.',
    PUBLISHED: 'Live. Publish link + platform recorded.',
};
const nextStage = (s) => STAGES[Math.min(STAGES.indexOf(s) + 1, STAGES.length - 1)];
const prevStage = (s) => STAGES[Math.max(STAGES.indexOf(s) - 1, 0)];

export default function VideoProductionBoard() {
    const [stage, setStage] = useState('QUEUED');
    const [search, setSearch] = useState('');
    const [rows, setRows] = useState([]);
    const [counts, setCounts] = useState({});
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [busyKey, setBusyKey] = useState(null);
    const [elevenEnabled, setElevenEnabled] = useState(false);
    const [voices, setVoices] = useState([]);
    const [voiceSel, setVoiceSel] = useState({}); // id -> voice key
    const [expanded, setExpanded] = useState({}); // id -> show script
    const [copiedId, setCopiedId] = useState(null); // brief "Copied ✓" feedback
    // Local field drafts: id -> { video_url, audio_url, final_url, publish_url, publish_platform, prod_notes }
    const [fields, setFields] = useState({});

    const load = useCallback(async () => {
        setLoading(true);
        setErr('');
        try {
            const qs = new URLSearchParams();
            qs.set('stage', stage);
            if (search.trim()) qs.set('search', search.trim());
            qs.set('limit', '300');
            const res = await fetch(`/api/video-production/board?${qs.toString()}`);
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Failed to load');
            setRows(j.rows);
            setCounts(j.counts_by_stage || {});
            setTotal(j.total);
            setElevenEnabled(!!j.elevenlabs_enabled);
            setVoices(j.voices || []);
            const seeded = {};
            for (const r of j.rows) {
                seeded[r.video_script_id] = {
                    video_url: r.video_url || '',
                    audio_url: r.audio_url || '',
                    final_url: r.final_url || '',
                    publish_url: r.publish_url || '',
                    publish_platform: r.publish_platform || '',
                    prod_notes: r.prod_notes || '',
                };
            }
            setFields(seeded);
        } catch (e) { setErr(e.message); }
        finally { setLoading(false); }
    }, [stage, search]);

    useEffect(() => { load(); }, [load]);

    const setField = (id, key, value) =>
        setFields(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }));

    const patch = async (row, body, busyLabel) => {
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
            // If the stage changed, the card leaves this tab — reload. Otherwise patch in place.
            if (body.prod_stage && body.prod_stage !== stage) {
                await load();
            } else {
                setRows(prev => prev.map(r => r.video_script_id === id ? { ...r, ...j.row } : r));
            }
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    // Save the current field drafts (URLs + notes) without changing stage.
    const saveFields = (row) => patch(row, fields[row.video_script_id] || {}, 'save');
    // Save fields AND advance/retreat.
    const move = (row, toStage) => patch(row, { ...(fields[row.video_script_id] || {}), prod_stage: toStage }, 'move');
    const toggleAudio = (row) => patch(row, { needs_audio: !row.needs_audio }, 'audio-toggle');

    // Copy the transcript to the clipboard for pasting into NotebookLM as a source.
    const copyScript = async (row) => {
        try {
            await navigator.clipboard.writeText(row.transcript || '');
            setCopiedId(row.video_script_id);
            setTimeout(() => setCopiedId(prev => (prev === row.video_script_id ? null : prev)), 2000);
        } catch {
            setErr('Clipboard copy failed — use "show script" and copy manually.');
        }
    };

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
            setField(id, 'audio_url', j.row.audio_url || '');
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const UrlField = ({ id, fkey, label, placeholder }) => (
        <label className="block">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">{label}</span>
            <div className="flex gap-1 mt-0.5">
                <input
                    value={fields[id]?.[fkey] ?? ''}
                    onChange={e => setField(id, fkey, e.target.value)}
                    placeholder={placeholder}
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {fields[id]?.[fkey] && (
                    <a href={fields[id][fkey]} target="_blank" rel="noreferrer"
                        className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 text-blue-600 whitespace-nowrap">
                        open ↗
                    </a>
                )}
            </div>
        </label>
    );

    return (
        <div className="px-4 py-4 max-w-[1100px] mx-auto">
            <header className="mb-4 border-b pb-3">
                <h1 className="text-2xl font-bold text-gray-900">Video Production</h1>
                <p className="text-gray-500 text-sm mt-0.5">
                    Approved scripts → NotebookLM video → (optional ElevenLabs audio) → edit/combine → publish. Track each video through the pipeline.
                </p>
            </header>

            {err && <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{err}</div>}

            <div className="flex gap-2 mb-2 border-b pb-2 flex-wrap items-center">
                {STAGES.map(s => (
                    <button key={s} onClick={() => setStage(s)}
                        className={`px-3 py-1.5 rounded text-xs font-bold
                            ${stage === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        {STAGE_LABEL[s]} <span className={`ml-1 font-normal ${stage === s ? 'text-blue-100' : 'text-gray-500'}`}>
                            ({counts[s] || 0})</span>
                    </button>
                ))}
                <div className="flex-1" />
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search word or script…"
                    className="px-3 py-1.5 border border-gray-300 rounded text-sm w-56"
                />
                <button onClick={load} className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50">Refresh</button>
            </div>

            <p className="text-xs text-gray-500 mb-3">{STAGE_HINT[stage]}</p>
            {stage === 'VIDEO' && !elevenEnabled && (
                <div className="mb-3 p-2 bg-amber-50 text-amber-700 border border-amber-200 rounded text-xs">
                    ElevenLabs isn’t configured (no <code>ELEVENLABS_API_KEY</code>) — audio is paste-link only until it’s set.
                </div>
            )}

            <div className="text-xs text-gray-500 mb-3">
                {loading ? 'Loading…' : `${total} in ${STAGE_LABEL[stage]}`}
            </div>

            <div className="space-y-4">
                {rows.map(row => {
                    const id = row.video_script_id;
                    return (
                        <div key={id} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-400 text-xs font-mono">#{row.word_sno ?? '—'}</span>
                                    <h2 className="text-lg font-bold text-gray-900">{row.word}</h2>
                                    <button onClick={() => setExpanded(p => ({ ...p, [id]: !p[id] }))}
                                        className="text-[11px] text-blue-600 hover:underline">
                                        {expanded[id] ? 'hide script' : 'show script'}
                                    </button>
                                    <button onClick={() => copyScript(row)}
                                        title="Copy the transcript to paste into NotebookLM as a source"
                                        className={`px-2 py-0.5 text-[11px] font-bold rounded border
                                            ${copiedId === id
                                                ? 'border-green-300 text-green-700 bg-green-50'
                                                : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                                        {copiedId === id ? 'Copied ✓' : '⧉ Copy for NotebookLM'}
                                    </button>
                                </div>
                                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-700">
                                    {STAGE_LABEL[row.prod_stage] || row.prod_stage}
                                </span>
                            </div>

                            {expanded[id] && (
                                <pre className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded text-sm whitespace-pre-wrap font-sans leading-relaxed">
                                    {row.transcript}
                                </pre>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <UrlField id={id} fkey="video_url" label="Video link (NotebookLM)" placeholder="Drive / YouTube unlisted / …" />

                                <div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Audio</span>
                                        <label className="flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer">
                                            <input type="checkbox" checked={row.needs_audio} onChange={() => toggleAudio(row)} />
                                            needs audio
                                        </label>
                                    </div>
                                    <div className="flex gap-1 mt-0.5">
                                        <input
                                            value={fields[id]?.audio_url ?? ''}
                                            onChange={e => setField(id, 'audio_url', e.target.value)}
                                            placeholder="MP3 link (or generate →)"
                                            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        />
                                        {fields[id]?.audio_url && (
                                            <a href={fields[id].audio_url} target="_blank" rel="noreferrer"
                                                className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 text-blue-600">▶</a>
                                        )}
                                        <select
                                            value={voiceSel[id] || voices[0]?.key || ''}
                                            onChange={e => setVoiceSel(prev => ({ ...prev, [id]: e.target.value }))}
                                            className="px-1.5 py-1 border border-gray-300 rounded text-xs max-w-[110px]">
                                            {voices.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                                        </select>
                                        <button
                                            onClick={() => generateAudio(row)}
                                            disabled={!elevenEnabled || !row.needs_audio || busyKey === `gen-audio-${id}`}
                                            title={!elevenEnabled ? 'ELEVENLABS_API_KEY not set' : 'Generate audio with ElevenLabs'}
                                            className="px-2 py-1 text-xs font-bold rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 whitespace-nowrap">
                                            {busyKey === `gen-audio-${id}` ? '…' : 'Generate'}
                                        </button>
                                    </div>
                                    {row.audio_status === 'FAILED' && row.audio_error && (
                                        <p className="text-[11px] text-red-600 mt-0.5">Audio failed: {row.audio_error}</p>
                                    )}
                                    {row.audio_status === 'DONE' && <p className="text-[11px] text-green-600 mt-0.5">Audio generated ✓</p>}
                                </div>

                                <UrlField id={id} fkey="final_url" label="Final edited video" placeholder="Rendered Reel/Short link" />

                                {(row.prod_stage === 'READY' || row.prod_stage === 'PUBLISHED') && (
                                    <div className="grid grid-cols-2 gap-2">
                                        <label className="block">
                                            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Platform</span>
                                            <input
                                                value={fields[id]?.publish_platform ?? ''}
                                                onChange={e => setField(id, 'publish_platform', e.target.value)}
                                                placeholder="Instagram / YT Shorts"
                                                className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                            />
                                        </label>
                                        <UrlField id={id} fkey="publish_url" label="Publish link" placeholder="Live post URL" />
                                    </div>
                                )}
                            </div>

                            <label className="block mt-3">
                                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Notes</span>
                                <textarea
                                    value={fields[id]?.prod_notes ?? ''}
                                    onChange={e => setField(id, 'prod_notes', e.target.value)}
                                    rows={2}
                                    placeholder="Anything the next step needs to know…"
                                    className="w-full border border-gray-300 rounded p-2 text-sm mt-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                />
                            </label>

                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                                <button onClick={() => saveFields(row)} disabled={busyKey === `save-${id}`}
                                    className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-bold rounded hover:bg-gray-50 disabled:opacity-50">
                                    {busyKey === `save-${id}` ? 'Saving…' : 'Save'}
                                </button>
                                {row.prod_stage !== 'QUEUED' && (
                                    <button onClick={() => move(row, prevStage(row.prod_stage))} disabled={busyKey === `move-${id}`}
                                        className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs font-bold rounded hover:bg-gray-50 disabled:opacity-50">
                                        ← {STAGE_LABEL[prevStage(row.prod_stage)]}
                                    </button>
                                )}
                                {row.prod_stage !== 'PUBLISHED' && (
                                    <button onClick={() => move(row, nextStage(row.prod_stage))} disabled={busyKey === `move-${id}`}
                                        className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded hover:bg-green-700 disabled:opacity-50">
                                        {busyKey === `move-${id}` ? 'Moving…' : `${STAGE_LABEL[nextStage(row.prod_stage)]} →`}
                                    </button>
                                )}
                                {row.published_at && (
                                    <span className="text-[11px] text-gray-400 ml-auto">
                                        published {new Date(row.published_at).toLocaleString()}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}

                {!loading && rows.length === 0 && (
                    <div className="text-center text-gray-400 py-16 text-sm">
                        Nothing in {STAGE_LABEL[stage]}.
                        {stage === 'QUEUED' && ' Approve scripts on the Video Scripts page to queue them here.'}
                    </div>
                )}
            </div>
        </div>
    );
}
