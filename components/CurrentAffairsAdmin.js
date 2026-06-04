'use client';

import { useState, useEffect, useCallback } from 'react';
import { CA_SUBTYPES } from '@/lib/cgl-mock-spec.js';

const STATUS_TABS = ['NEW', 'APPROVED', 'REJECTED'];

export default function CurrentAffairsAdmin() {
    const [filterStatus, setFilterStatus] = useState('NEW');
    const [filterYear, setFilterYear] = useState('');
    const [filterQuarter, setFilterQuarter] = useState('');
    const [filterSubtype, setFilterSubtype] = useState('');
    const [search, setSearch] = useState('');
    const [rows, setRows] = useState([]);
    const [counts, setCounts] = useState({});
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [busyKey, setBusyKey] = useState(null);
    const [showImport, setShowImport] = useState(false);
    const [showBackfill, setShowBackfill] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setErr('');
        try {
            const qs = new URLSearchParams();
            if (filterStatus) qs.set('status', filterStatus);
            if (filterYear) qs.set('year', filterYear);
            if (filterQuarter) qs.set('quarter', filterQuarter);
            if (filterSubtype) qs.set('subtype', filterSubtype);
            if (search.trim()) qs.set('search', search.trim());
            qs.set('limit', '200');
            const res = await fetch(`/api/current-affairs/list?${qs.toString()}`);
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Failed to load');
            setRows(j.rows);
            setCounts(j.counts_by_status || {});
            setTotal(j.total);
        } catch (e) { setErr(e.message); }
        finally { setLoading(false); }
    }, [filterStatus, filterYear, filterQuarter, filterSubtype, search]);

    useEffect(() => { load(); }, [load]);

    const updateRow = (id, patch) => {
        setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    };

    const saveEdit = async (id, patch) => {
        setBusyKey(`edit-${id}`);
        setErr('');
        try {
            const res = await fetch(`/api/current-affairs/${id}/edit`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Edit failed');
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const approve = async (id) => {
        setBusyKey(`approve-${id}`);
        setErr('');
        try {
            const res = await fetch(`/api/current-affairs/${id}/approve`, { method: 'POST' });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Approve failed');
            await load();
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const reject = async (id) => {
        const reason = prompt('Reason for rejection (optional):');
        if (reason === null) return;
        setBusyKey(`reject-${id}`);
        setErr('');
        try {
            const res = await fetch(`/api/current-affairs/${id}/reject`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Reject failed');
            await load();
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    return (
        <div className="px-4 py-4 max-w-[1400px] mx-auto">
            <header className="mb-4 flex items-center justify-between border-b pb-3">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Current Affairs — Review</h1>
                    <p className="text-gray-500 text-sm mt-0.5">Tag, edit, approve. Approved CAs flow into the bank as bilingual GA questions.</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setShowBackfill(true)}
                        className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50">
                        Backfill old placeholders
                    </button>
                    <button onClick={() => setShowImport(true)}
                        className="px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-md hover:bg-green-700">
                        + Import batch
                    </button>
                </div>
            </header>

            {err && <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{err}</div>}

            <div className="flex gap-2 mb-3 border-b pb-2 flex-wrap items-center">
                {STATUS_TABS.map(s => (
                    <button key={s} onClick={() => setFilterStatus(s)}
                        className={`px-3 py-1.5 rounded text-xs font-bold
                            ${filterStatus === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        {s} <span className={`ml-1 font-normal ${filterStatus === s ? 'text-blue-100' : 'text-gray-500'}`}>
                            ({counts[s] || 0})
                        </span>
                    </button>
                ))}
                <input type="number" placeholder="year" value={filterYear}
                    onChange={e => setFilterYear(e.target.value)}
                    className="ml-2 w-20 text-xs border border-gray-300 rounded px-2 py-1" />
                <select value={filterQuarter} onChange={e => setFilterQuarter(e.target.value)}
                    className="text-xs border border-gray-300 rounded px-2 py-1">
                    <option value="">all quarters</option>
                    {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
                </select>
                <select value={filterSubtype} onChange={e => setFilterSubtype(e.target.value)}
                    className="text-xs border border-gray-300 rounded px-2 py-1">
                    <option value="">all subtypes</option>
                    {CA_SUBTYPES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input type="text" placeholder="search…" value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="text-xs border border-gray-300 rounded px-2 py-1 flex-1 min-w-[160px]" />
                <span className="ml-auto text-xs text-gray-500">{total} total · showing {rows.length}</span>
            </div>

            {loading ? (
                <div className="p-6 text-gray-400 text-sm">Loading…</div>
            ) : rows.length === 0 ? (
                <div className="p-6 text-gray-400 text-sm text-center">No rows match filters.</div>
            ) : (
                <div className="space-y-3">
                    {rows.map(row => (
                        <CaRow key={row.id} row={row} busyKey={busyKey}
                            onPatch={(patch) => updateRow(row.id, patch)}
                            onSave={(patch) => saveEdit(row.id, patch)}
                            onApprove={() => approve(row.id)}
                            onReject={() => reject(row.id)} />
                    ))}
                </div>
            )}

            {showImport && <ImportModal onClose={() => { setShowImport(false); load(); }} />}
            {showBackfill && <BackfillModal onClose={() => { setShowBackfill(false); load(); }} />}
        </div>
    );
}

function CaRow({ row, busyKey, onPatch, onSave, onApprove, onReject }) {
    const mcq = row.mcq_json || {};
    const stem = mcq.stem || '';
    const opts = mcq.options || {};
    const correct = mcq.correct_option_label || '';
    const isNew = row.status === 'NEW';
    const editing = isNew; // inline edit for NEW; read-only otherwise

    const patchStem = (v) => onPatch({ mcq_json: { ...mcq, stem: v } });
    const patchOpt = (k, v) => onPatch({ mcq_json: { ...mcq, options: { ...opts, [k]: v } } });
    const patchCorrect = (v) => onPatch({ mcq_json: { ...mcq, correct_option_label: v } });

    const persistText = (field, value) => {
        if (field === 'stem') onSave({ stem: value });
        else if (field.startsWith('option_')) onSave({ options: { [field.split('_')[1]]: value } });
        else if (field === 'correct_option_label') onSave({ correct_option_label: value });
        else onSave({ [field]: value });
    };

    const statusBadge = row.status === 'APPROVED'
        ? <span className="px-2 py-0.5 rounded bg-green-100 text-green-800 text-[10px] font-bold">APPROVED</span>
        : row.status === 'REJECTED'
            ? <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 text-[10px] font-bold">REJECTED</span>
            : <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">NEW</span>;

    return (
        <div className="border border-gray-200 rounded-lg p-3 bg-white">
            <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap text-xs">
                <div className="flex items-center gap-2">
                    {statusBadge}
                    <span className="font-mono text-[10px] text-gray-400">{row.id.slice(0, 8)}</span>
                    {row.materialized_question_id && (
                        <span className="text-[10px] text-gray-500 font-mono">→ qid {row.materialized_question_id.slice(0, 8)}</span>
                    )}
                </div>
                <div className="flex gap-1 items-center">
                    <select disabled={!editing} value={row.ca_subtype || ''}
                        onChange={e => { onPatch({ ca_subtype: e.target.value }); persistText('ca_subtype', e.target.value); }}
                        className="text-xs border border-gray-300 rounded px-1 py-0.5">
                        <option value="">— subtype —</option>
                        {CA_SUBTYPES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <input type="number" disabled={!editing} min={2000} max={2100} value={row.relevance_year || ''}
                        onChange={e => { onPatch({ relevance_year: e.target.value }); persistText('relevance_year', e.target.value); }}
                        className="w-16 text-xs border border-gray-300 rounded px-1 py-0.5" placeholder="year" />
                    <select disabled={!editing} value={row.relevance_quarter || ''}
                        onChange={e => { onPatch({ relevance_quarter: e.target.value }); persistText('relevance_quarter', e.target.value); }}
                        className="text-xs border border-gray-300 rounded px-1 py-0.5">
                        <option value="">Q?</option>
                        {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
                    </select>
                    <select disabled={!editing} value={row.difficulty || ''}
                        onChange={e => { onPatch({ difficulty: e.target.value }); persistText('difficulty', e.target.value); }}
                        className="text-xs border border-gray-300 rounded px-1 py-0.5">
                        <option value="">L?</option>
                        {[1, 2, 3, 4].map(d => <option key={d} value={d}>L{d}</option>)}
                    </select>
                </div>
            </div>
            <textarea disabled={!editing} value={stem}
                onChange={e => patchStem(e.target.value)}
                onBlur={e => editing && persistText('stem', e.target.value)}
                rows={2}
                className="w-full text-sm border border-gray-200 rounded p-2 mb-2 disabled:bg-gray-50 disabled:text-gray-700" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2">
                {['A', 'B', 'C', 'D'].map(k => (
                    <label key={k} className={`flex items-center gap-1.5 p-1.5 rounded border text-xs
                        ${correct === k ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'}`}>
                        <input type="radio" disabled={!editing} checked={correct === k}
                            onChange={() => { patchCorrect(k); persistText('correct_option_label', k); }}
                            className="w-3 h-3" />
                        <span className="font-bold text-gray-700">{k}.</span>
                        <input type="text" disabled={!editing} value={opts[k] || ''}
                            onChange={e => patchOpt(k, e.target.value)}
                            onBlur={e => editing && persistText(`option_${k}`, e.target.value)}
                            className="flex-1 bg-transparent text-sm outline-none" />
                    </label>
                ))}
            </div>
            {row.rejection_reason && (
                <div className="text-[11px] text-red-700 mb-2">Rejected: {row.rejection_reason}</div>
            )}
            {isNew && (
                <div className="flex gap-2 justify-end">
                    <button onClick={onReject}
                        disabled={busyKey === `reject-${row.id}`}
                        className="text-xs px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        {busyKey === `reject-${row.id}` ? '…' : 'Reject'}
                    </button>
                    <button onClick={onApprove}
                        disabled={busyKey === `approve-${row.id}`}
                        className="text-xs px-4 py-1 rounded bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-50">
                        {busyKey === `approve-${row.id}` ? 'Approving…' : 'Approve →'}
                    </button>
                </div>
            )}
        </div>
    );
}

function ImportModal({ onClose }) {
    const [json, setJson] = useState('');
    const [year, setYear] = useState(new Date().getFullYear());
    const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [err, setErr] = useState('');

    const submit = async () => {
        setBusy(true); setErr(''); setResult(null);
        try {
            let items;
            try { items = JSON.parse(json); }
            catch { throw new Error('Could not parse as JSON'); }
            if (!Array.isArray(items)) throw new Error('Top level must be an array');
            const res = await fetch('/api/current-affairs/import', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items, year: parseInt(year, 10), quarter: parseInt(quarter, 10) }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Import failed');
            setResult(j);
        } catch (e) { setErr(e.message); }
        finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[92vh] flex flex-col">
                <div className="px-5 py-3 border-b flex items-center justify-between">
                    <h2 className="text-lg font-bold">Import CA batch</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-800 text-xl">&times;</button>
                </div>
                <div className="p-5 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <label className="block">
                            <span className="text-xs font-semibold text-gray-600 uppercase">Year</span>
                            <input type="number" min={2000} max={2100} value={year}
                                onChange={e => setYear(e.target.value)}
                                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mt-1" />
                        </label>
                        <label className="block">
                            <span className="text-xs font-semibold text-gray-600 uppercase">Quarter</span>
                            <select value={quarter} onChange={e => setQuarter(e.target.value)}
                                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mt-1">
                                {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
                            </select>
                        </label>
                    </div>
                    <label className="block">
                        <span className="text-xs font-semibold text-gray-600 uppercase">
                            Paste JSON array — items with {`{ question, options: {A,B,C,D}, answer }`}
                        </span>
                        <textarea value={json} onChange={e => setJson(e.target.value)}
                            rows={14} placeholder='[ { "question": "…", "options": { "A":"…","B":"…","C":"…","D":"…" }, "answer": "A" }, … ]'
                            className="w-full font-mono text-xs border border-gray-300 rounded px-2 py-1.5 mt-1" />
                    </label>
                    {err && <div className="mt-3 p-2 bg-red-50 text-red-700 border border-red-200 rounded text-xs">{err}</div>}
                    {result && (
                        <div className="mt-3 p-2 bg-green-50 text-green-800 border border-green-200 rounded text-xs">
                            Inserted {result.inserted_count} rows; skipped {result.skipped?.length || 0}.
                        </div>
                    )}
                </div>
                <div className="px-5 py-3 border-t flex justify-end gap-2">
                    <button onClick={onClose} disabled={busy}
                        className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50">Close</button>
                    <button onClick={submit} disabled={busy}
                        className="px-4 py-1.5 bg-green-600 text-white text-sm font-bold rounded hover:bg-green-700 disabled:opacity-50">
                        {busy ? 'Importing…' : 'Import →'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function BackfillModal({ onClose }) {
    const [freshness, setFreshness] = useState(4);
    const [dryRun, setDryRun] = useState(true);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [err, setErr] = useState('');

    const submit = async () => {
        setBusy(true); setErr(''); setResult(null);
        try {
            const res = await fetch('/api/current-affairs/backfill-placeholders', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ca_freshness_quarters: parseInt(freshness, 10),
                    dry_run: dryRun,
                }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Backfill failed');
            setResult(j);
        } catch (e) { setErr(e.message); }
        finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-xl w-full p-5">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold">Backfill old GA CA placeholders</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-800 text-xl">&times;</button>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                    Walks every CGL T1 mock, finds unfilled <code className="bg-gray-100 px-1 rounded">PLACEHOLDER_GA_CA_*</code> slots,
                    and fills them with approved CAs (newest first) that haven&apos;t been used in any CGL T1 mock yet.
                </p>
                <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                        <span className="text-xs font-semibold text-gray-600 uppercase">CA freshness (quarters)</span>
                        <input type="number" min={1} max={20} value={freshness}
                            onChange={e => setFreshness(e.target.value)}
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mt-1" />
                    </label>
                    <label className="flex items-end gap-2 pb-1.5">
                        <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
                        <span className="text-xs">Dry run (no writes)</span>
                    </label>
                </div>
                {err && <div className="mt-3 p-2 bg-red-50 text-red-700 border border-red-200 rounded text-xs">{err}</div>}
                {result && (
                    <div className="mt-3 p-2 bg-blue-50 text-blue-800 border border-blue-200 rounded text-xs">
                        Pool size: {result.ca_pool_size} · Filled: {result.total_placeholders_filled} · Pool remaining: {result.ca_pool_remaining}
                        <div className="mt-1 text-[10px] text-blue-700">
                            {result.mocks.filter(m => m.ca_placeholders > 0).slice(0, 20).map(m => (
                                <div key={m.mock_test_id}>
                                    {m.mock_test_id.slice(0, 8)} · ph {m.ca_placeholders} → filled {m.filled} {m.still_pending > 0 ? `(${m.still_pending} pending)` : ''}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div className="flex justify-end gap-2 mt-3">
                    <button onClick={onClose} disabled={busy}
                        className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50">Close</button>
                    <button onClick={submit} disabled={busy}
                        className="px-4 py-1.5 bg-blue-600 text-white text-sm font-bold rounded hover:bg-blue-700 disabled:opacity-50">
                        {busy ? 'Running…' : (dryRun ? 'Run dry →' : 'Run →')}
                    </button>
                </div>
            </div>
        </div>
    );
}
