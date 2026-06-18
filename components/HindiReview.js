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

// Severity ordering (worst first). Used to pick the badge color when an
// item has multiple issues.
const SEVERITY_RANK = { high: 0, medium: 1, low: 2, ok: 3 };

const SEV_CELL_CLASS = {
    high:   'bg-red-600 text-white border-red-700',
    medium: 'bg-orange-500 text-white border-orange-600',
    low:    'bg-yellow-300 text-yellow-900 border-yellow-400',
    ok:     'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200',
};

const SEV_TAG_CLASS = {
    high:   'bg-red-100 text-red-800 border-red-300',
    medium: 'bg-orange-100 text-orange-800 border-orange-300',
    low:    'bg-yellow-100 text-yellow-800 border-yellow-300',
};

async function parseResponse(res) {
    const text = await res.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { error: text.slice(0, 240) }; }
}

// --- Heuristic issue detection -------------------------------------------
// Flags translations and source questions that probabilistically have errors,
// surfaced as colored badges in the side panel + tags above each card. Tuned
// for false-positive tolerance over recall — a flagged row is meant to draw
// review attention, not to be auto-rejected.
function hasDevanagari(s) {
    return /[ऀ-ॿ]/.test(s || '');
}
function devanagariRatio(s) {
    if (!s) return 0;
    const stripped = s.replace(/[\s\d\p{P}]/gu, '');  // ignore digits / punctuation / whitespace
    if (!stripped.length) return 0;
    const dev = (stripped.match(/[ऀ-ॿ]/g) || []).length;
    return dev / stripped.length;
}

function detectIssues(item) {
    const issues = [];
    const enStem = item.en?.body_json?.text || '';
    const hiStem = item.hi?.body_json?.text || '';
    const enOpts = item.en?.options || {};
    const hiOpts = item.hi?.options || {};

    // HI missing entirely.
    if (item.hi == null) {
        issues.push({ severity: 'high', tag: 'HI missing', detail: 'No Hindi version yet — click Translate HI.' });
    } else {
        // HI text identical to EN — translation didn't actually run.
        if (hiStem && enStem && hiStem.trim() === enStem.trim()) {
            issues.push({ severity: 'high', tag: 'HI == EN', detail: 'HI stem is identical to EN stem.' });
        } else if (hiStem && !hasDevanagari(hiStem)) {
            issues.push({ severity: 'high', tag: 'No Devanagari', detail: 'HI stem contains no Devanagari characters.' });
        } else if (hiStem && devanagariRatio(hiStem) < 0.3) {
            issues.push({ severity: 'medium', tag: 'Low Devanagari', detail: `Only ${Math.round(devanagariRatio(hiStem) * 100)}% of HI letters are Devanagari.` });
        }
    }

    // EN looks Hindi — the user's #1 complaint.
    if (hasDevanagari(enStem)) {
        issues.push({ severity: 'high', tag: 'EN looks Hindi', detail: 'EN stem contains Devanagari characters — likely a mis-tagged source question.' });
    }

    // Option-level checks.
    let shortOpts = 0;
    let missingHiOpts = 0;
    let identicalOpts = 0;
    for (const k of ['A', 'B', 'C', 'D']) {
        const enOpt = (enOpts[k]?.text || '').trim();
        if (enOpt.length < 3 && enOpt.length > 0) shortOpts++;
        if (enOpt.length === 0) {
            issues.push({ severity: 'high', tag: `EN ${k} blank`, detail: `EN option ${k} is empty.` });
        }
        if (item.hi) {
            const hiOpt = (hiOpts[k]?.text || '').trim();
            if (!hiOpt) missingHiOpts++;
            else if (hiOpt === enOpt && enOpt) identicalOpts++;
            else if (!hasDevanagari(hiOpt) && hasDevanagari(hiStem)) {
                // HI stem is in Devanagari but option isn't — likely missed.
                issues.push({ severity: 'medium', tag: `Opt ${k} not HI`, detail: `HI option ${k} has no Devanagari.` });
            }
        }
    }
    if (shortOpts > 0) {
        issues.push({ severity: 'low', tag: `Short opts (${shortOpts})`, detail: `${shortOpts} option(s) are very short.` });
    }
    if (missingHiOpts > 0) {
        issues.push({ severity: 'high', tag: `Missing HI opts (${missingHiOpts})`, detail: `${missingHiOpts} HI option(s) are blank.` });
    }
    if (identicalOpts > 0) {
        issues.push({ severity: 'medium', tag: `${identicalOpts} opt(s) HI==EN`, detail: `${identicalOpts} HI option(s) match EN verbatim.` });
    }

    // EN stem unusually short — possibly truncated / incomplete.
    if (enStem.trim().length > 0 && enStem.trim().length < 20) {
        issues.push({ severity: 'low', tag: 'Short stem', detail: 'EN stem is unusually short — may be truncated.' });
    }

    return issues;
}

function worstSeverity(issues) {
    if (!issues || issues.length === 0) return 'ok';
    return issues.reduce((acc, i) => (SEVERITY_RANK[i.severity] < SEVERITY_RANK[acc] ? i.severity : acc), 'ok');
}

function cardDomId(item) {
    return `q-${item.section_code}-${item.position}`;
}

export default function HindiReview({ mockTestId }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [busyKey, setBusyKey] = useState(null);
    const [sectionFilter, setSectionFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('PENDING'); // PENDING | APPROVED | ALL
    const [issuesOnly, setIssuesOnly] = useState(false);

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

    // Precompute issues + severity per item. Memoized off `data` so the
    // map survives re-renders driven by filters but invalidates whenever
    // the underlying mock content changes (translate, save, swap, junk).
    const issuesByQid = useMemo(() => {
        const map = new Map();
        if (!data) return map;
        for (const it of data.items) {
            const issues = detectIssues(it);
            map.set(it.question_id, { issues, severity: worstSeverity(issues) });
        }
        return map;
    }, [data]);

    const issueTotals = useMemo(() => {
        const totals = { high: 0, medium: 0, low: 0 };
        for (const v of issuesByQid.values()) {
            if (v.severity in totals) totals[v.severity]++;
        }
        return totals;
    }, [issuesByQid]);

    const filtered = useMemo(() => {
        if (!data) return [];
        return data.items.filter(it => {
            if (sectionFilter !== 'ALL' && it.section_code !== sectionFilter) return false;
            if (statusFilter === 'PENDING' && (it.hi == null || it.hi.status === 'APPROVED')) return false;
            if (statusFilter === 'APPROVED' && it.hi?.status !== 'APPROVED') return false;
            if (issuesOnly && (issuesByQid.get(it.question_id)?.severity || 'ok') === 'ok') return false;
            return true;
        });
    }, [data, sectionFilter, statusFilter, issuesOnly, issuesByQid]);

    const scrollToCard = (item) => {
        const el = document.getElementById(cardDomId(item));
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            el.classList.add('ring-2', 'ring-blue-400');
            setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 1500);
        }
    };

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

    // One-click approval for both sides of the mock:
    //   1. /hindi-review/approve {all:true}  → flips HI qv.status='APPROVED'
    //   2. /mock-test/[id]/approve-all       → flips mtq.review_status='APPROVED'
    //                                          AND mock.status='APPROVED'
    //
    // Step 2 is also what unblocks Publish (which requires mock.status='APPROVED'
    // AND zero PENDING mtq rows — Swap/Junk insert new rows as PENDING).
    const approveAll = async () => {
        if (!confirm('Approve every Hindi translation AND every English question in this mock?')) return;
        setBusyKey('approve-all'); setErr('');
        try {
            const r1 = await fetch(`/api/mock-test/${mockTestId}/hindi-review/approve`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ all: true }),
            });
            const j1 = await parseResponse(r1);
            if (!r1.ok || !j1.success) throw new Error(j1.error || `Approve HI failed (${r1.status})`);

            const r2 = await fetch(`/api/mock-test/${mockTestId}/approve-all`, { method: 'POST' });
            const j2 = await parseResponse(r2);
            if (!r2.ok || !j2.success) throw new Error(j2.error || `Approve EN failed (${r2.status})`);

            await load();
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const publish = async () => {
        if (!confirm('Publish this mock? It will become a permanent record (no further edits without rollback).')) return;
        setBusyKey('publish'); setErr('');
        try {
            const r = await fetch(`/api/mock-test/${mockTestId}/publish`, { method: 'POST' });
            const j = await parseResponse(r);
            if (!r.ok || !j.success) throw new Error(j.error || `Publish failed (${r.status})`);
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

    // Per-row translate trigger. Two paths depending on whether a HI sibling
    // already exists for this EN qid:
    //
    //   - hi != null:  in-place re-translate. POSTs /api/translate for stem
    //     + 4 options, then PATCHes via /hindi-review/edit (cheap, just
    //     overwrites the existing HI qv text — no new qid / link created).
    //
    //   - hi == null:  fresh translate + link. Happens for freshly-swapped
    //     or freshly-junked rows where the EN qid is new and has no HI
    //     sibling anywhere. Calls /api/gd-mock/[id]/translate-and-link with
    //     ?question_id=<id> to mint the new HI qid + link + qv + solution
    //     translation in one go.
    const retranslate = async (item) => {
        const key = `retranslate-${item.question_id}`;
        setBusyKey(key); setErr('');
        try {
            if (item.hi == null) {
                // Mint path — full translate-and-link for just this row.
                const r = await fetch(
                    `/api/gd-mock/${mockTestId}/translate-and-link?question_id=${item.question_id}`,
                    { method: 'POST' }
                );
                const j = await parseResponse(r);
                if (!r.ok || !j.success) throw new Error(j.error || `Translate failed (${r.status})`);
                await load();
                return;
            }

            // In-place path — overwrite HI text only.
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
        <div className="px-4 py-4 max-w-[1600px] mx-auto">
            <header className="mb-4 flex items-baseline justify-between border-b pb-3">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Hindi Review — {mock.name}</h1>
                    <p className="text-gray-500 text-sm mt-0.5">
                        Status: <span className="font-semibold">{mock.status}</span>
                        {' · '}{review_stats.translated}/{review_stats.total} translated · {review_stats.approved} approved
                        {(issueTotals.high + issueTotals.medium + issueTotals.low) > 0 && (
                            <span className="ml-2 text-gray-500">
                                · issues:
                                {issueTotals.high   > 0 && <span className="ml-1 text-red-600 font-semibold">{issueTotals.high} high</span>}
                                {issueTotals.medium > 0 && <span className="ml-1 text-orange-600 font-semibold">{issueTotals.medium} med</span>}
                                {issueTotals.low    > 0 && <span className="ml-1 text-yellow-700 font-semibold">{issueTotals.low} low</span>}
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Link href="/cgl-mock-builder" className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50">← Builder</Link>
                    <button onClick={approveAll}
                        disabled={busyKey === 'approve-all' || review_stats.translated === 0 || mock.status === 'PUBLISHED'}
                        title="Approves every Hindi translation AND every English question (mtq.review_status). After this, the mock can be Published."
                        className="px-3 py-1.5 bg-green-600 text-white text-sm font-bold rounded hover:bg-green-700 disabled:opacity-50">
                        {busyKey === 'approve-all' ? 'Approving…' : 'Approve all (EN + HI)'}
                    </button>
                    {mock.status === 'APPROVED' && (
                        <button onClick={publish}
                            disabled={busyKey === 'publish'}
                            title="Publish this mock. Refuses if any mtq row is still PENDING (Swap/Junk insert as PENDING — re-run Approve all to catch up)."
                            className="px-3 py-1.5 bg-blue-600 text-white text-sm font-bold rounded hover:bg-blue-700 disabled:opacity-50">
                            {busyKey === 'publish' ? 'Publishing…' : 'Publish'}
                        </button>
                    )}
                    {mock.status === 'PUBLISHED' && (
                        <span className="px-3 py-1.5 bg-emerald-100 text-emerald-800 text-sm font-bold rounded border border-emerald-300">
                            ✓ Published
                        </span>
                    )}
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
                <button onClick={() => setIssuesOnly(v => !v)}
                    title="Show only rows with detected issues (red/orange/yellow)."
                    className={`ml-3 px-2.5 py-1 rounded font-semibold border
                        ${issuesOnly ? 'bg-red-600 text-white border-red-700' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                    {issuesOnly ? '⚠ Issues only' : '⚠ Issues only'}
                </button>
                <span className="ml-auto text-gray-500">Showing {filtered.length}</span>
            </div>

            <div className="flex gap-4 items-start">
                <IssueSidePanel
                    items={data.items}
                    issuesByQid={issuesByQid}
                    onJump={scrollToCard}
                    sectionFilter={sectionFilter} />

                <div className="flex-1 min-w-0">
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
                                    issues={issuesByQid.get(item.question_id)?.issues || []}
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
            </div>
        </div>
    );
}

// Sticky grid of question numbers, color-coded by issue severity.
// Lives to the left of the cards on the review page. Click → scroll to card.
function IssueSidePanel({ items, issuesByQid, onJump, sectionFilter }) {
    // Group by section, preserving the order items already arrived in
    // (the API sorts by exam_section_id then position).
    const sections = useMemo(() => {
        const grouped = {};
        for (const it of items) {
            const k = it.section_code || '?';
            if (!grouped[k]) grouped[k] = [];
            grouped[k].push(it);
        }
        return Object.entries(grouped);
    }, [items]);

    return (
        <aside className="w-56 shrink-0 sticky top-4 bg-white border border-gray-200 rounded-lg p-3 text-xs self-start max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="font-bold text-gray-700 mb-1">Questions</div>
            <div className="text-[10px] text-gray-500 mb-2 leading-tight">
                Click a number to jump. Color = worst issue severity.
            </div>
            <div className="flex gap-1 flex-wrap text-[10px] text-gray-500 mb-3">
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-600 inline-block" />high</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-500 inline-block" />med</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-300 inline-block" />low</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-200 inline-block" />ok</span>
            </div>
            {sections.map(([sec, list]) => {
                if (sectionFilter !== 'ALL' && sec !== sectionFilter) return null;
                const sectionIssueCount = list.reduce((acc, it) => {
                    const sev = issuesByQid.get(it.question_id)?.severity || 'ok';
                    return sev === 'ok' ? acc : acc + 1;
                }, 0);
                return (
                    <div key={sec} className="mb-3">
                        <div className="flex items-baseline justify-between mb-1">
                            <span className="font-mono font-bold text-gray-700">{sec}</span>
                            {sectionIssueCount > 0 && (
                                <span className="text-[10px] text-gray-500">{sectionIssueCount} issue(s)</span>
                            )}
                        </div>
                        <div className="grid grid-cols-5 gap-1">
                            {list.map(it => {
                                const sev = issuesByQid.get(it.question_id)?.severity || 'ok';
                                const cls = SEV_CELL_CLASS[sev] || SEV_CELL_CLASS.ok;
                                const title = sev === 'ok'
                                    ? `#${it.position} ${sec}`
                                    : `#${it.position} ${sec} — ` + (issuesByQid.get(it.question_id)?.issues || [])
                                          .map(i => i.tag).join(' · ');
                                return (
                                    <button key={it.question_id}
                                        onClick={() => onJump(it)}
                                        title={title}
                                        className={`text-[10px] font-bold py-1 rounded border ${cls}`}>
                                        {it.position}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </aside>
    );
}

function BilingualCard({ item, mockTestId, busyKey, issues = [], onSave, onSaveEn, onApprove, onRetranslate, onSwap, onJunk }) {
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

    // Shared image-paste state for both editors.
    const [uploadingImage, setUploadingImage] = useState(false);
    const [uploadErr, setUploadErr] = useState(null);

    // Paste a clipboard image, upload it via /api/upload (Cloudinary), insert
    // the resulting ![](url) markdown at the cursor position. Mirrors the
    // pattern in NewSolutionReviewBilingual. The EN side targets the EN qid;
    // the HI side targets the linked HI qid (item.hi_question_id), so the
    // asset lives under the right question's namespace.
    const handleImagePaste = async (e, currentValue, setNewValue, { language, role, optionKey }) => {
        const items = Array.from(e.clipboardData?.items || []);
        const imgItem = items.find(it => it.type && it.type.startsWith('image/'));
        if (!imgItem) return;
        e.preventDefault();
        const el = e.target;
        const start = (typeof el.selectionStart === 'number') ? el.selectionStart : currentValue.length;
        const end   = (typeof el.selectionEnd   === 'number') ? el.selectionEnd   : currentValue.length;

        let file = imgItem.getAsFile();
        if ((!file || file.size === 0) && e.clipboardData?.files?.length) {
            file = e.clipboardData.files[0];
        }
        if (!file) return;
        if (file.size === 0) {
            setUploadErr('Clipboard image is empty (0 bytes). Try copying again, or use Win+Shift+S.');
            return;
        }

        const targetQid = language === 'HI'
            ? (item.hi_question_id || item.question_id)
            : item.question_id;
        const targetVersion = language === 'HI'
            ? (item.hi_version_no ?? item.version_no)
            : item.version_no;

        setUploadingImage(true); setUploadErr(null);
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Could not read image'));
                reader.readAsDataURL(file);
            });
            const body = {
                data: dataUrl,
                question_id: targetQid,
                version_no: targetVersion,
                language,
                role,
            };
            if (optionKey) body.option_key = optionKey;
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const json = await res.json();
            const url = json.latexPath || json.secure_url || json.url;
            if (!res.ok || !url) throw new Error(json.error || 'Upload failed');
            const markdown = `![](${url})`;
            setNewValue(currentValue.slice(0, start) + markdown + currentValue.slice(end));
        } catch (err) {
            setUploadErr('Image upload failed: ' + err.message);
        } finally {
            setUploadingImage(false);
        }
    };

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
        <div id={cardDomId(item)} className="bg-white border border-gray-200 rounded-lg p-3 scroll-mt-4 transition-shadow">
            {issues.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mb-2">
                    {issues.map((iss, i) => (
                        <span key={i} title={iss.detail}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded border ${SEV_TAG_CLASS[iss.severity] || ''}`}>
                            {iss.tag}
                        </span>
                    ))}
                </div>
            )}
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
                            <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-bold text-gray-500 uppercase">Stem</span>
                                <span className="text-[10px] text-gray-400">paste image (Ctrl+V) supported</span>
                            </div>
                            <textarea value={draftEnStem}
                                onChange={e => setDraftEnStem(e.target.value)}
                                onPaste={e => handleImagePaste(e, draftEnStem, setDraftEnStem,
                                    { language: 'EN', role: 'stem' })}
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
                                        onPaste={e => handleImagePaste(e, draftEnOpts[k],
                                            (next) => setDraftEnOpts(prev => ({ ...prev, [k]: next })),
                                            { language: 'EN', role: 'option', optionKey: k })}
                                        className="flex-1 p-1.5 border border-amber-200 rounded text-sm font-mono" />
                                </div>
                            ))}
                            {(uploadingImage || uploadErr) && (
                                <div className={`text-[11px] rounded px-2 py-1 mt-1 ${uploadingImage
                                    ? 'bg-amber-50 border border-amber-200 text-amber-700'
                                    : 'bg-red-50 border border-red-200 text-red-700'}`}>
                                    {uploadingImage ? 'Uploading image…' : uploadErr}
                                </div>
                            )}
                            <div className="flex gap-2 justify-end mt-2">
                                <button onClick={() => setEditingEn(false)} disabled={savingEn || uploadingImage}
                                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
                                    Cancel
                                </button>
                                <button onClick={saveEn} disabled={savingEn || uploadingImage}
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
                            <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-bold text-gray-500 uppercase">Stem</span>
                                <span className="text-[10px] text-gray-400">paste image (Ctrl+V) supported</span>
                            </div>
                            <textarea value={draftStem}
                                onChange={e => setDraftStem(e.target.value)}
                                onPaste={e => handleImagePaste(e, draftStem, setDraftStem,
                                    { language: 'HI', role: 'stem' })}
                                rows={Math.max(3, Math.min(10, Math.ceil((draftStem.length || 0) / 80)))}
                                className="w-full p-2 border border-purple-300 rounded text-sm font-mono mb-1.5" />
                            {['A', 'B', 'C', 'D'].map(k => (
                                <div key={k} className="flex items-center gap-1.5 mb-1">
                                    <span className="font-bold text-gray-600 w-4">{k}.</span>
                                    <input type="text" value={draftOpts[k]}
                                        onChange={e => setDraftOpts(prev => ({ ...prev, [k]: e.target.value }))}
                                        onPaste={e => handleImagePaste(e, draftOpts[k],
                                            (next) => setDraftOpts(prev => ({ ...prev, [k]: next })),
                                            { language: 'HI', role: 'option', optionKey: k })}
                                        className="flex-1 p-1.5 border border-purple-200 rounded text-sm font-mono" />
                                </div>
                            ))}
                            {(uploadingImage || uploadErr) && (
                                <div className={`text-[11px] rounded px-2 py-1 mt-1 ${uploadingImage
                                    ? 'bg-amber-50 border border-amber-200 text-amber-700'
                                    : 'bg-red-50 border border-red-200 text-red-700'}`}>
                                    {uploadingImage ? 'Uploading image…' : uploadErr}
                                </div>
                            )}
                            <div className="flex gap-2 justify-end mt-2">
                                <button onClick={() => setEditing(false)} disabled={saving || uploadingImage}
                                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
                                    Cancel
                                </button>
                                <button onClick={save} disabled={saving || uploadingImage}
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
