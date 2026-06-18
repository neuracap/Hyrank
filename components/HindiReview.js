'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import Latex from '@/components/Latex';

const SECTION_LABELS = {
    REASONING: 'General Intelligence & Reasoning',
    GA: 'General Awareness',
    QUANT: 'Quantitative Aptitude',
};

const STATUS_TONE = {
    APPROVED: 'bg-green-100 text-green-800 border-green-300',
    DRAFT: 'bg-amber-100 text-amber-800 border-amber-300',
};

async function parseResponse(res) {
    const text = await res.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { error: text.slice(0, 240) }; }
}

export default function HindiReview({ mockTestId }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [busyKey, setBusyKey] = useState(null);
    const [sectionFilter, setSectionFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('PENDING'); // PENDING | APPROVED | ALL

    const load = useCallback(async () => {
        setLoading(true);
        setErr('');
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/hindi-review`);
            const j = await parseResponse(res);
            if (!res.ok || !j.success) throw new Error(j.error || `Load failed (${res.status})`);
            setData(j);
        } catch (e) { setErr(e.message); }
        finally { setLoading(false); }
    }, [mockTestId]);

    useEffect(() => { load(); }, [load]);

    const filtered = useMemo(() => {
        if (!data) return [];
        return data.items.filter(it => {
            if (sectionFilter !== 'ALL' && it.section_code !== sectionFilter) return false;
            if (statusFilter === 'PENDING' && (it.hi == null || it.hi.status === 'APPROVED')) return false;
            if (statusFilter === 'APPROVED' && it.hi?.status !== 'APPROVED') return false;
            return true;
        });
    }, [data, sectionFilter, statusFilter]);

    const approveOne = async (item) => {
        const key = `approve-${item.question_id}`;
        setBusyKey(key); setErr('');
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/hindi-review/approve`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id: item.question_id, version_no: item.version_no }),
            });
            const j = await parseResponse(res);
            if (!res.ok || !j.success) throw new Error(j.error || `Approve failed (${res.status})`);
            await load();
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const approveAll = async () => {
        if (!confirm('Approve every translated Hindi question in this mock?')) return;
        setBusyKey('approve-all'); setErr('');
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/hindi-review/approve`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ all: true }),
            });
            const j = await parseResponse(res);
            if (!res.ok || !j.success) throw new Error(j.error || `Approve-all failed (${res.status})`);
            await load();
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const saveEdit = async (item, patch) => {
        const key = `save-${item.question_id}`;
        setBusyKey(key); setErr('');
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/hindi-review/edit`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: item.question_id,
                    version_no: item.version_no,
                    ...patch,
                }),
            });
            const j = await parseResponse(res);
            if (!res.ok || !j.success) throw new Error(j.error || `Save failed (${res.status})`);
            // local-patch HI body+options so we don't refetch the whole list
            setData(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    items: prev.items.map(it => {
                        if (it.question_id !== item.question_id) return it;
                        const nextHi = { ...(it.hi || { options: {} }) };
                        if (typeof patch.stem === 'string') {
                            nextHi.body_json = { ...(nextHi.body_json || {}), text: patch.stem };
                        }
                        if (patch.options) {
                            nextHi.options = { ...(nextHi.options || {}) };
                            for (const [k, txt] of Object.entries(patch.options)) {
                                nextHi.options[k] = { ...(nextHi.options[k] || {}), text: txt };
                            }
                        }
                        nextHi.status = 'DRAFT';
                        return { ...it, hi: nextHi };
                    }),
                };
            });
        } catch (e) { setErr(e.message); throw e; }
        finally { setBusyKey(null); }
    };

    // Re-run google-translate on the EN stem + 4 options and overwrite
    // the HI side. Used when the original machine translation reads poorly
    // and the reviewer wants a fresh attempt before hand-editing. Solution
    // is not re-translated (the edit route only patches stem + options).
    const retranslate = async (item) => {
        const key = `retranslate-${item.question_id}`;
        setBusyKey(key); setErr('');
        try {
            const enStem = item.en.body_json?.text || '';
            const enOpts = item.en.options || {};

            const translateOne = async (text) => {
                if (!text || !text.trim()) return '';
                const r = await fetch('/api/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, source: 'en', target: 'hi' }),
                });
                const j = await parseResponse(r);
                if (!r.ok) throw new Error(j.error || `Translate API failed (${r.status})`);
                return j.translatedText || '';
            };

            // Sequential — google-translate-api-x throttles parallel calls.
            const hiStem = await translateOne(enStem);
            const hiOpts = {};
            for (const k of ['A', 'B', 'C', 'D']) {
                hiOpts[k] = await translateOne(enOpts[k]?.text || '');
            }

            await saveEdit(item, { stem: hiStem, options: hiOpts });
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    // Edit the EN side in place. Patches body_json.text + option_json.text
    // (+ correct_option_label) via the shared cgl-mock edit-question route.
    // HI side may now be stale — caller is encouraged to click Re-translate.
    const saveEnEdit = async (item, patch) => {
        const key = `save-en-${item.question_id}`;
        setBusyKey(key); setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}/edit-question`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id: item.question_id, ...patch }),
            });
            const j = await parseResponse(res);
            if (!res.ok || !j.success) throw new Error(j.error || `Save EN failed (${res.status})`);
            // Optimistic local patch on EN side
            setData(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    items: prev.items.map(it => {
                        if (it.question_id !== item.question_id) return it;
                        const nextEn = { ...it.en };
                        if (typeof patch.stem === 'string') {
                            nextEn.body_json = { ...(nextEn.body_json || {}), text: patch.stem };
                        }
                        if (patch.options) {
                            nextEn.options = { ...(nextEn.options || {}) };
                            for (const [k, txt] of Object.entries(patch.options)) {
                                nextEn.options[k] = { ...(nextEn.options[k] || {}), text: txt };
                            }
                        }
                        const nextCorrect = patch.correct_option_label || it.correct_option_label;
                        return { ...it, en: nextEn, correct_option_label: nextCorrect };
                    }),
                };
            });
        } catch (e) { setErr(e.message); throw e; }
        finally { setBusyKey(null); }
    };

    // Swap a question out for a fresh bank/PYQ candidate matching the
    // same subtype/difficulty. After swap the question_id changes and
    // the HI sibling is orphaned — caller must re-fetch the page.
    const swap = async (item, opts = {}) => {
        if (!confirm('Swap this question for a fresh one from the bank? The current Hindi translation will become orphaned (re-translate after).')) return;
        const key = `swap-${item.question_id}`;
        setBusyKey(key); setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}/swap`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id: item.question_id, ...opts }),
            });
            const j = await parseResponse(res);
            if (!res.ok || !j.success) throw new Error(j.error || `Swap failed (${res.status})`);
            await load();
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    // Junk: mark the EN question_version as JUNK (picker excludes it
    // forever) and try to swap in a replacement; if none, leaves a
    // placeholder on the mock.
    const junk = async (item) => {
        const reason = prompt('Reason for junking this question (optional)?');
        if (reason === null) return;  // user pressed cancel
        const key = `junk-${item.question_id}`;
        setBusyKey(key); setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}/junk`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id: item.question_id, reason: reason || null }),
            });
            const j = await parseResponse(res);
            if (!res.ok || !j.success) throw new Error(j.error || `Junk failed (${res.status})`);
            await load();
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    if (loading) return <div className="p-6 text-gray-400">Loading…</div>;
    if (err && !data) return <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{err}</div>;
    if (!data) return null;

    const { mock, review_stats } = data;

    return (
        <div className="px-4 py-4 max-w-[1400px] mx-auto">
            <header className="mb-4 flex items-baseline justify-between border-b pb-3">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Hindi Review — {mock.name}</h1>
                    <p className="text-gray-500 text-sm mt-0.5">
                        Status: <span className="font-semibold">{mock.status}</span>
                        {' · '}{review_stats.translated}/{review_stats.total} translated · {review_stats.approved} approved
                    </p>
                </div>
                <div className="flex gap-2">
                    <Link href="/cgl-mock-builder" className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50">← Builder</Link>
                    <button onClick={approveAll}
                        disabled={busyKey === 'approve-all' || review_stats.translated === 0}
                        className="px-3 py-1.5 bg-green-600 text-white text-sm font-bold rounded hover:bg-green-700 disabled:opacity-50">
                        {busyKey === 'approve-all' ? 'Approving…' : 'Approve all translated'}
                    </button>
                </div>
            </header>

            {err && <div className="mb-3 p-2 bg-red-50 text-red-700 border border-red-200 rounded text-xs">{err}</div>}

            <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 flex items-center gap-3 flex-wrap text-xs">
                <span className="font-semibold text-gray-700">Section:</span>
                {[{ k: 'ALL', l: `All (${review_stats.total})` }, ...review_stats.by_section.map(s => ({ k: s.code, l: `${s.code} (${s.translated}/${s.total})` }))].map(s => (
                    <button key={s.k} onClick={() => setSectionFilter(s.k)}
                        className={`px-2.5 py-1 rounded font-semibold
                            ${sectionFilter === s.k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        {s.l}
                    </button>
                ))}
                <span className="font-semibold text-gray-700 ml-3">Status:</span>
                {[
                    { k: 'PENDING', l: 'Pending' },
                    { k: 'APPROVED', l: 'Approved' },
                    { k: 'ALL', l: 'All' },
                ].map(s => (
                    <button key={s.k} onClick={() => setStatusFilter(s.k)}
                        className={`px-2.5 py-1 rounded font-semibold
                            ${statusFilter === s.k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        {s.l}
                    </button>
                ))}
                <span className="ml-auto text-gray-500">Showing {filtered.length}</span>
            </div>

            {filtered.length === 0 ? (
                <div className="p-6 bg-white rounded-lg border border-gray-200 text-center text-gray-400 text-sm">
                    Nothing matches the filters.
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(item => (
                        <BilingualCard key={item.question_id}
                            item={item}
                            mockTestId={mockTestId}
                            busyKey={busyKey}
                            onSave={(patch) => saveEdit(item, patch)}
                            onSaveEn={(patch) => saveEnEdit(item, patch)}
                            onApprove={() => approveOne(item)}
                            onRetranslate={() => retranslate(item)}
                            onSwap={() => swap(item)}
                            onJunk={() => junk(item)} />
                    ))}
                </div>
            )}
        </div>
    );
}

function BilingualCard({ item, mockTestId, busyKey, onSave, onSaveEn, onApprove, onRetranslate, onSwap, onJunk }) {
    const enText = item.en.body_json?.text || '';
    const enOpts = item.en.options || {};
    const hi = item.hi;
    const hiText = hi?.body_json?.text || '';
    const hiOpts = hi?.options || {};

    const [editing, setEditing] = useState(false);
    const [draftStem, setDraftStem] = useState('');
    const [draftOpts, setDraftOpts] = useState({ A: '', B: '', C: '', D: '' });
    const [saving, setSaving] = useState(false);

    // Separate state for the EN inline editor (independent of HI editor).
    const [editingEn, setEditingEn] = useState(false);
    const [draftEnStem, setDraftEnStem] = useState('');
    const [draftEnOpts, setDraftEnOpts] = useState({ A: '', B: '', C: '', D: '' });
    const [draftCorrect, setDraftCorrect] = useState('A');
    const [savingEn, setSavingEn] = useState(false);

    const startEdit = () => {
        setDraftStem(hiText);
        setDraftOpts({
            A: hiOpts.A?.text || '',
            B: hiOpts.B?.text || '',
            C: hiOpts.C?.text || '',
            D: hiOpts.D?.text || '',
        });
        setEditing(true);
    };

    const startEditEn = () => {
        setDraftEnStem(enText);
        setDraftEnOpts({
            A: enOpts.A?.text || '',
            B: enOpts.B?.text || '',
            C: enOpts.C?.text || '',
            D: enOpts.D?.text || '',
        });
        setDraftCorrect(item.correct_option_label || 'A');
        setEditingEn(true);
    };

    const save = async () => {
        const patch = {};
        if (draftStem !== hiText) patch.stem = draftStem;
        const optsPatch = {};
        for (const k of ['A', 'B', 'C', 'D']) {
            if (draftOpts[k] !== (hiOpts[k]?.text || '')) optsPatch[k] = draftOpts[k];
        }
        if (Object.keys(optsPatch).length) patch.options = optsPatch;
        if (Object.keys(patch).length === 0) { setEditing(false); return; }
        setSaving(true);
        try { await onSave(patch); setEditing(false); }
        catch { /* parent surfaces err */ }
        finally { setSaving(false); }
    };

    const saveEn = async () => {
        const patch = {};
        if (draftEnStem !== enText) patch.stem = draftEnStem;
        const optsPatch = {};
        for (const k of ['A', 'B', 'C', 'D']) {
            if (draftEnOpts[k] !== (enOpts[k]?.text || '')) optsPatch[k] = draftEnOpts[k];
        }
        if (Object.keys(optsPatch).length) patch.options = optsPatch;
        if (draftCorrect !== item.correct_option_label) patch.correct_option_label = draftCorrect;
        if (Object.keys(patch).length === 0) { setEditingEn(false); return; }
        setSavingEn(true);
        try { await onSaveEn(patch); setEditingEn(false); }
        catch { /* parent surfaces err */ }
        finally { setSavingEn(false); }
    };

    const status = hi?.status || 'NOT_TRANSLATED';
    const statusBadge = (
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${STATUS_TONE[status] || 'bg-gray-100 text-gray-600 border-gray-300'}`}>
            {status}
        </span>
    );

    return (
        <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="flex items-baseline gap-2 mb-2 flex-wrap text-xs">
                <span className="font-bold text-gray-500">#{item.position}</span>
                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-mono">{item.section_code}</span>
                <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono">{item.subtype || '?'}</span>
                <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-bold">L{item.difficulty}</span>
                <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-bold">Ans: {item.correct_option_label}</span>
                {statusBadge}
                <span className="ml-auto flex gap-1.5 flex-wrap justify-end">
                    {!editing && !editingEn && (
                        <button onClick={startEditEn}
                            disabled={busyKey === `save-en-${item.question_id}`}
                            title="Edit the English stem / 4 options / correct answer. After saving, click Re-translate to refresh HI."
                            className="text-xs px-2 py-1 border border-amber-300 text-amber-800 rounded hover:bg-amber-50 disabled:opacity-50">
                            Edit EN
                        </button>
                    )}
                    {!editing && !editingEn && (
                        <button onClick={onSwap}
                            disabled={busyKey === `swap-${item.question_id}`}
                            title="Swap this question for a fresh one of the same subtype + difficulty. HI sibling is orphaned after — re-translate."
                            className="text-xs px-2 py-1 border border-orange-300 text-orange-700 rounded hover:bg-orange-50 disabled:opacity-50">
                            {busyKey === `swap-${item.question_id}` ? 'Swapping…' : 'Swap'}
                        </button>
                    )}
                    {!editing && !editingEn && (
                        <button onClick={onJunk}
                            disabled={busyKey === `junk-${item.question_id}`}
                            title="Mark the EN question as JUNK (picker excludes forever) + remove from this mock."
                            className="text-xs px-2 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50">
                            {busyKey === `junk-${item.question_id}` ? 'Junking…' : 'Junk'}
                        </button>
                    )}
                    {!editing && !editingEn && (
                        <Link href={`/gd-mock-builder?mock=${mockTestId}`}
                            target="_blank"
                            title="Open this mock in the full builder for advanced swap options (PYQ-preferred, passage-length filter, etc.)."
                            className="text-xs px-2 py-1 border border-gray-300 text-gray-700 rounded hover:bg-gray-100">
                            Builder ↗
                        </Link>
                    )}
                    {!editing && !editingEn && (
                        <button onClick={onRetranslate}
                            disabled={busyKey === `retranslate-${item.question_id}` || busyKey === `save-${item.question_id}`}
                            title={hi
                                ? 'Re-run google-translate on EN stem + 4 options and overwrite the HI side. Solution is not retranslated.'
                                : 'Translate this question from EN (stem + 4 options).'}
                            className="text-xs px-2 py-1 border border-purple-300 text-purple-700 rounded hover:bg-purple-50 disabled:opacity-50">
                            {busyKey === `retranslate-${item.question_id}`
                                ? 'Translating…'
                                : (hi ? 'Re-translate' : 'Translate HI')}
                        </button>
                    )}
                    {!editing && !editingEn && hi && (
                        <button onClick={startEdit}
                            className="text-xs px-2 py-1 border border-blue-300 text-blue-700 rounded hover:bg-blue-50">
                            Edit HI
                        </button>
                    )}
                    {!editing && !editingEn && hi && status !== 'APPROVED' && (
                        <button onClick={onApprove}
                            disabled={busyKey === `approve-${item.question_id}`}
                            className="text-xs px-3 py-1 bg-green-600 text-white font-bold rounded hover:bg-green-700 disabled:opacity-50">
                            {busyKey === `approve-${item.question_id}` ? '…' : 'Approve'}
                        </button>
                    )}
                </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* EN column */}
                <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">English (source)</div>
                    {!editingEn ? (
                        <>
                            <div className="p-2 bg-gray-50 border border-gray-100 rounded text-sm mb-1.5"><Latex>{enText}</Latex></div>
                            {['A', 'B', 'C', 'D'].map(k => (
                                <div key={k} className={`flex gap-1.5 p-1.5 mb-1 rounded border text-sm
                                    ${item.correct_option_label === k ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'}`}>
                                    <span className="font-bold text-gray-600">{k}.</span>
                                    <div className="flex-1"><Latex>{enOpts[k]?.text || ''}</Latex></div>
                                </div>
                            ))}
                        </>
                    ) : (
                        <>
                            <textarea value={draftEnStem} onChange={e => setDraftEnStem(e.target.value)}
                                rows={Math.max(3, Math.min(10, Math.ceil((draftEnStem.length || 0) / 80)))}
                                className="w-full p-2 border border-amber-400 rounded text-sm font-mono mb-1.5" />
                            {['A', 'B', 'C', 'D'].map(k => (
                                <div key={k} className="flex items-center gap-1.5 mb-1">
                                    <label className="flex items-center gap-1 text-xs font-bold text-gray-600">
                                        <input type="radio" name={`correct-en-${item.question_id}`}
                                            checked={draftCorrect === k}
                                            onChange={() => setDraftCorrect(k)}
                                            className="cursor-pointer" />
                                        {k}.
                                    </label>
                                    <input type="text" value={draftEnOpts[k]}
                                        onChange={e => setDraftEnOpts(prev => ({ ...prev, [k]: e.target.value }))}
                                        className="flex-1 p-1.5 border border-amber-200 rounded text-sm font-mono" />
                                </div>
                            ))}
                            <div className="flex gap-2 justify-end mt-2">
                                <button onClick={() => setEditingEn(false)} disabled={savingEn}
                                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
                                    Cancel
                                </button>
                                <button onClick={saveEn} disabled={savingEn}
                                    title="Save EN changes. HI will be marked DRAFT — click Re-translate to refresh."
                                    className="text-xs px-3 py-1 bg-amber-600 text-white font-bold rounded hover:bg-amber-700 disabled:opacity-50">
                                    {savingEn ? 'Saving…' : 'Save EN'}
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* HI column */}
                <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Hindi</div>
                    {hi == null ? (
                        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                            Not translated yet. Run “Translate to Hindi” on the builder review page.
                        </div>
                    ) : !editing ? (
                        <>
                            <div className="p-2 bg-purple-50 border border-purple-200 rounded text-sm mb-1.5"><Latex>{hiText}</Latex></div>
                            {['A', 'B', 'C', 'D'].map(k => (
                                <div key={k} className={`flex gap-1.5 p-1.5 mb-1 rounded border text-sm
                                    ${item.correct_option_label === k ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'}`}>
                                    <span className="font-bold text-gray-600">{k}.</span>
                                    <div className="flex-1"><Latex>{hiOpts[k]?.text || ''}</Latex></div>
                                </div>
                            ))}
                        </>
                    ) : (
                        <>
                            <textarea value={draftStem} onChange={e => setDraftStem(e.target.value)}
                                rows={Math.max(3, Math.min(10, Math.ceil((draftStem.length || 0) / 80)))}
                                className="w-full p-2 border border-purple-300 rounded text-sm font-mono mb-1.5" />
                            {['A', 'B', 'C', 'D'].map(k => (
                                <div key={k} className="flex items-center gap-1.5 mb-1">
                                    <span className="font-bold text-gray-600 w-4">{k}.</span>
                                    <input type="text" value={draftOpts[k]}
                                        onChange={e => setDraftOpts(prev => ({ ...prev, [k]: e.target.value }))}
                                        className="flex-1 p-1.5 border border-purple-200 rounded text-sm font-mono" />
                                </div>
                            ))}
                            <div className="flex gap-2 justify-end mt-2">
                                <button onClick={() => setEditing(false)} disabled={saving}
                                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
                                    Cancel
                                </button>
                                <button onClick={save} disabled={saving}
                                    className="text-xs px-3 py-1 bg-purple-600 text-white font-bold rounded hover:bg-purple-700 disabled:opacity-50">
                                    {saving ? 'Saving…' : 'Save HI'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
