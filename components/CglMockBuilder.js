'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import Latex from '@/components/Latex';
import { SECTION_SPEC, SUBTYPE_PREFIXES, SECTION_CODES, SECTION_DIFFICULTY_BASE } from '@/lib/cgl-mock-spec.js';

const DIFFICULTY_LEVELS = [1, 2, 3, 4];

function placeholderCountForCode(config, code) {
    if (code === 'REASONING') return config.reasoning_img_placeholder_count;
    return 0;
}

function defaultProfileFor(config) {
    const out = {};
    for (const code of SECTION_CODES) {
        const base = SECTION_DIFFICULTY_BASE[code];
        const ph = placeholderCountForCode(config, code);
        const row = { L1: base.L1, L2: base.L2, L3: base.L3, L4: base.L4 };
        // Eat placeholders from L3 first (highest base), then L2, L4, L1
        let left = ph;
        for (const k of ['L3', 'L2', 'L4', 'L1']) {
            const take = Math.min(row[k], left);
            row[k] -= take;
            left -= take;
        }
        out[code] = row;
    }
    return out;
}

function profileRowSum(row) {
    if (!row) return 0;
    return (row.L1 || 0) + (row.L2 || 0) + (row.L3 || 0) + (row.L4 || 0);
}

function profileMatchesConfig(profile, config) {
    for (const code of SECTION_CODES) {
        const need = 25 - placeholderCountForCode(config, code);
        if (profileRowSum(profile?.[code]) !== need) return false;
    }
    return true;
}

// Map a bank's full qv.subtype to its spec-slug (e.g. arithmetic_percentage_chain → 'arithmetic')
function specSlugForSubtype(bankSubtype) {
    if (!bankSubtype) return null;
    for (const [slug, prefixes] of Object.entries(SUBTYPE_PREFIXES)) {
        for (const p of prefixes) {
            const stripped = p.endsWith('%') ? p.slice(0, -1) : p;
            if (bankSubtype.startsWith(stripped)) return slug;
        }
    }
    return null;
}

const SECTION_LABELS = {
    REASONING: 'General Intelligence & Reasoning',
    GA: 'General Awareness',
    QUANT: 'Quantitative Aptitude',
    ENGLISH: 'English Comprehension',
};

const DEFAULT_CONFIG = {
    include_english_rc: true,
    include_english_cloze: true,
    include_quant_di: true,
    reasoning_img_placeholder_count: 0,
    rc_min_passage_chars: 1400,
    cloze_min_passage_chars: 700,
    ca_freshness_quarters: 4,
};

export default function CglMockBuilder() {
    const [drafts, setDrafts] = useState([]);
    const [loadingList, setLoadingList] = useState(false);
    const [error, setError] = useState('');

    const [showConfig, setShowConfig] = useState(false);
    const [config, setConfig] = useState(DEFAULT_CONFIG);
    const [mockName, setMockName] = useState('');
    const [generating, setGenerating] = useState(false);
    const [difficultyProfile, setDifficultyProfile] = useState(() => defaultProfileFor(DEFAULT_CONFIG));
    // When placeholder counts change, reset the profile so each row sums to 25 - placeholders.
    // Discards in-progress user edits to that row — explicit and predictable beats clever.
    useEffect(() => {
        setDifficultyProfile(defaultProfileFor(config));
    }, [config.reasoning_img_placeholder_count]);

    // Step 2 (planning) state: preview data + the user's bank-subtype targets per section
    const [planStep, setPlanStep] = useState(false);
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [userTargets, setUserTargets] = useState({}); // { SECTION: { bank_subtype: N } }

    const [selectedId, setSelectedId] = useState(null);

    const fetchDrafts = useCallback(async () => {
        setLoadingList(true);
        try {
            const res = await fetch('/api/cgl-mock/list?status=DRAFT');
            const data = await res.json();
            if (res.ok && data.success) setDrafts(data.rows);
            else throw new Error(data.error || 'Failed to load drafts');
        } catch (e) { setError(e.message); }
        finally { setLoadingList(false); }
    }, []);

    useEffect(() => { fetchDrafts(); }, [fetchDrafts]);

    const startPlanning = async () => {
        setPreviewing(true);
        setError('');
        try {
            const res = await fetch('/api/cgl-mock/preview', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...config }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Preview failed');
            setPreview(j);
            // Initialize userTargets from the suggested_plan
            setUserTargets(JSON.parse(JSON.stringify(j.suggested_plan || {})));
            setPlanStep(true);
        } catch (e) { setError(e.message); }
        finally { setPreviewing(false); }
    };

    const generate = async () => {
        setGenerating(true);
        setError('');
        try {
            const body = { ...config };
            if (mockName.trim()) body.name = mockName.trim();
            if (planStep && preview) {
                body.plan = { bank_subtype_targets: userTargets };
            }
            body.difficulty_profile = difficultyProfile;
            const res = await fetch('/api/cgl-mock/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Generate failed');
            setShowConfig(false); setPlanStep(false); setPreview(null);
            setMockName('');
            await fetchDrafts();
            setSelectedId(data.mock_test_id);
        } catch (e) { setError(e.message); }
        finally { setGenerating(false); }
    };

    const closeConfigModal = () => {
        setShowConfig(false); setPlanStep(false); setPreview(null);
    };

    return (
        <div className="px-4 py-4 max-w-[1600px] mx-auto">
            <header className="mb-4 flex items-center justify-between border-b pb-3">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">SSC CGL Tier 1 — Mock Builder</h1>
                    <p className="text-gray-500 text-sm mt-0.5">
                        Bank-driven generator. Excludes any question used in any prior CGL T1 mock.
                    </p>
                </div>
                <div className="flex gap-3 items-center">
                    <select value={selectedId || ''} onChange={e => setSelectedId(e.target.value || null)}
                        className="text-sm border border-gray-300 rounded px-2 py-1.5 min-w-[280px]">
                        <option value="">— Choose a draft to review —</option>
                        {drafts.map(d => (
                            <option key={d.mock_test_id} value={d.mock_test_id}>
                                {d.name} ({d.question_count}q · {new Date(d.created_at).toLocaleDateString()})
                            </option>
                        ))}
                    </select>
                    <button onClick={() => setShowConfig(true)}
                        className="px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-md hover:bg-green-700 whitespace-nowrap">
                        + Make new mock test
                    </button>
                </div>
            </header>

            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

            {!selectedId && (
                <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-500">
                    {loadingList ? 'Loading drafts…' : drafts.length === 0
                        ? 'No drafts yet — click "Make new mock test" above.'
                        : 'Pick a draft from the dropdown to review it.'}
                </div>
            )}

            {showConfig && !planStep && (
                <ConfigModal
                    config={config}
                    setConfig={setConfig}
                    difficultyProfile={difficultyProfile}
                    setDifficultyProfile={setDifficultyProfile}
                    mockName={mockName}
                    setMockName={setMockName}
                    onClose={closeConfigModal}
                    onNext={startPlanning}
                    previewing={previewing}
                />
            )}
            {showConfig && planStep && preview && (
                <PlanModal
                    preview={preview}
                    userTargets={userTargets}
                    setUserTargets={setUserTargets}
                    onBack={() => setPlanStep(false)}
                    onClose={closeConfigModal}
                    onGenerate={generate}
                    generating={generating}
                />
            )}

            {selectedId && <MockReview key={selectedId} mockTestId={selectedId} onChanged={fetchDrafts} />}
        </div>
    );
}

function ConfigModal({ config, setConfig, difficultyProfile, setDifficultyProfile, mockName, setMockName, onClose, onNext, previewing }) {
    const upd = (k, v) => setConfig(prev => ({ ...prev, [k]: v }));
    const profileValid = profileMatchesConfig(difficultyProfile, config);

    const setLevel = (code, level, value) => {
        const n = Math.max(0, parseInt(value || '0', 10) || 0);
        setDifficultyProfile(prev => ({
            ...prev,
            [code]: { ...(prev?.[code] || { L1: 0, L2: 0, L3: 0, L4: 0 }), [`L${level}`]: n },
        }));
    };
    const resetRowToBase = (code) => {
        const base = SECTION_DIFFICULTY_BASE[code];
        const ph = placeholderCountForCode(config, code);
        const row = { L1: base.L1, L2: base.L2, L3: base.L3, L4: base.L4 };
        let left = ph;
        for (const k of ['L3', 'L2', 'L4', 'L1']) {
            const take = Math.min(row[k], left);
            row[k] -= take;
            left -= take;
        }
        setDifficultyProfile(prev => ({ ...prev, [code]: row }));
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6">
                <div className="text-xs font-semibold text-gray-400 uppercase mb-1">Step 1 of 2</div>
                <h2 className="text-lg font-bold mb-1">Configure mock</h2>
                <p className="text-xs text-gray-500 mb-4">4 sections × 25 = 100 questions. Set the per-mock difficulty distribution below; next step lets you adjust the subtype breakup.</p>
                <label className="block mb-3">
                    <span className="text-xs font-semibold text-gray-600 uppercase">Mock name (optional)</span>
                    <input type="text" value={mockName} onChange={e => setMockName(e.target.value)}
                        placeholder="e.g. CGL T1 Mock 1"
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mt-1" />
                </label>
                <div className="space-y-2 mt-2">
                    <CheckRow label="Include English RC set (5 Q)" checked={config.include_english_rc} onChange={v => upd('include_english_rc', v)} />
                    {config.include_english_rc && (
                        <div className="pl-6 flex items-center gap-2">
                            <span className="text-[11px] text-gray-500">RC passage minimum:</span>
                            <input type="number" min={0} max={5000} step={100}
                                value={config.rc_min_passage_chars}
                                onChange={e => upd('rc_min_passage_chars', Math.max(0, Math.min(5000, parseInt(e.target.value || '0', 10) || 0)))}
                                className="w-20 text-xs border border-gray-300 rounded px-2 py-1" />
                            <span className="text-[11px] text-gray-400">chars (≈ {Math.round(config.rc_min_passage_chars / 7)} words)</span>
                        </div>
                    )}
                    <CheckRow label="Include English Cloze set (5 Q)" checked={config.include_english_cloze} onChange={v => upd('include_english_cloze', v)} />
                    {config.include_english_cloze && (
                        <div className="pl-6 flex items-center gap-2">
                            <span className="text-[11px] text-gray-500">Cloze passage minimum:</span>
                            <input type="number" min={0} max={5000} step={100}
                                value={config.cloze_min_passage_chars}
                                onChange={e => upd('cloze_min_passage_chars', Math.max(0, Math.min(5000, parseInt(e.target.value || '0', 10) || 0)))}
                                className="w-20 text-xs border border-gray-300 rounded px-2 py-1" />
                            <span className="text-[11px] text-gray-400">chars (≈ {Math.round(config.cloze_min_passage_chars / 7)} words)</span>
                        </div>
                    )}
                    <CheckRow label="Include Quant DI set (~3 Q)" checked={config.include_quant_di} onChange={v => upd('include_quant_di', v)} />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4">
                    <NumberRow label="REASONING image placeholders" value={config.reasoning_img_placeholder_count}
                        onChange={v => upd('reasoning_img_placeholder_count', v)} max={10} />
                    <NumberRow label="CA freshness (last N quarters)" value={config.ca_freshness_quarters}
                        onChange={v => upd('ca_freshness_quarters', Math.max(1, v))} max={20} />
                </div>

                <div className="mt-5 border-t pt-4">
                    <div className="flex items-baseline justify-between mb-1">
                        <span className="text-xs font-semibold text-gray-600 uppercase">Difficulty distribution</span>
                        <span className="text-[10px] text-gray-400">drawn-question target per level; placeholders excluded</span>
                    </div>
                    <table className="text-xs w-full mt-1">
                        <thead>
                            <tr className="text-gray-500 text-[10px] uppercase border-b border-gray-200">
                                <th className="text-left font-semibold py-1.5 pr-2">Section</th>
                                {DIFFICULTY_LEVELS.map(l => <th key={l} className="text-center font-semibold py-1.5">L{l}</th>)}
                                <th className="text-right font-semibold py-1.5 pl-2">Sum / Need</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {SECTION_CODES.map(code => {
                                const row = difficultyProfile?.[code] || { L1: 0, L2: 0, L3: 0, L4: 0 };
                                const sum = profileRowSum(row);
                                const need = 25 - placeholderCountForCode(config, code);
                                const ok = sum === need;
                                return (
                                    <tr key={code} className="border-b border-gray-100 last:border-0">
                                        <td className="py-1.5 pr-2 font-mono text-gray-700 text-[11px]">{code}</td>
                                        {DIFFICULTY_LEVELS.map(l => (
                                            <td key={l} className="text-center py-1 px-0.5">
                                                <input type="number" min={0} max={25}
                                                    value={row[`L${l}`] ?? 0}
                                                    onChange={e => setLevel(code, l, e.target.value)}
                                                    className="w-12 text-center border border-gray-300 rounded px-1 py-0.5 text-sm tabular-nums" />
                                            </td>
                                        ))}
                                        <td className={`text-right py-1 pl-2 font-semibold tabular-nums ${ok ? 'text-green-700' : 'text-red-700'}`}>
                                            {sum} / {need}
                                        </td>
                                        <td className="pl-2 text-right">
                                            <button type="button" onClick={() => resetRowToBase(code)}
                                                className="text-[10px] text-blue-600 hover:underline" title="Reset this row to the CGL base">
                                                reset
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {!profileValid && (
                        <div className="text-[11px] text-red-700 mt-2">
                            Each row must sum to (25 − that section's placeholders) before you can continue.
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 mt-6">
                    <button onClick={onClose} disabled={previewing}
                        className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
                    <button onClick={onNext} disabled={previewing || !profileValid}
                        className="px-4 py-2 text-sm bg-blue-600 text-white font-bold rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                        {previewing ? 'Loading pool…' : 'Next: Plan distribution →'}
                    </button>
                </div>
            </div>
        </div>
    );
}
function CheckRow({ label, checked, onChange }) {
    return (<label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-4 h-4 text-blue-600 rounded" />
        <span>{label}</span></label>);
}
function NumberRow({ label, value, onChange, max = 10 }) {
    return (<label className="block">
        <span className="text-xs font-semibold text-gray-600 uppercase">{label}</span>
        <input type="number" min={0} max={max} value={value}
            onChange={e => onChange(Math.max(0, Math.min(max, parseInt(e.target.value || '0', 10))))}
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mt-1" /></label>);
}

// ---------- Plan-distribution modal (step 2) ----------

function PlanModal({ preview, userTargets, setUserTargets, onBack, onClose, onGenerate, generating }) {
    const [activeSection, setActiveSection] = useState(preview.sections?.[0]?.code || 'REASONING');
    const [filter, setFilter] = useState('');

    const setCount = (section, bankSubtype, n) => {
        const v = Math.max(0, parseInt(n || '0', 10) || 0);
        setUserTargets(prev => {
            const next = { ...prev };
            const sec = { ...(next[section] || {}) };
            if (v <= 0) delete sec[bankSubtype]; else sec[bankSubtype] = v;
            next[section] = sec;
            return next;
        });
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[92vh] flex flex-col">
                <div className="px-5 py-3 border-b flex items-center justify-between">
                    <div>
                        <div className="text-xs font-semibold text-gray-400 uppercase mb-0.5">Step 2 of 2</div>
                        <h2 className="text-lg font-bold">Plan distribution</h2>
                        <p className="text-xs text-gray-500">Pick exactly how many of each fine-grained subtype to include. Pool depth = available in the verified bank (excluding any prior CGL T1 mock).</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-800 text-xl">&times;</button>
                </div>

                {/* Section tabs */}
                <div className="px-5 pt-3 border-b flex gap-2">
                    {preview.sections.map(s => {
                        const planned = sumValues(userTargets[s.code]);
                        const need = s.inventory_needed ?? 0;
                        const over = planned > need;
                        const under = planned < need;
                        return (
                            <button key={s.code} onClick={() => setActiveSection(s.code)}
                                className={`px-3 py-1.5 rounded-t text-xs font-bold border-b-2
                                    ${activeSection === s.code ? 'border-blue-500 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                                {s.code}
                                <span className={`ml-1 font-normal ${over ? 'text-red-700' : under ? 'text-amber-700' : 'text-green-700'}`}>
                                    ({planned}/{need})
                                </span>
                            </button>
                        );
                    })}
                    <input type="text" value={filter} onChange={e => setFilter(e.target.value)}
                        placeholder="filter subtypes…"
                        className="ml-auto text-xs border border-gray-300 rounded px-2 py-1 w-48" />
                </div>

                {/* Section body */}
                <div className="flex-1 overflow-y-auto p-4">
                    {preview.sections.filter(s => s.code === activeSection).map(s => (
                        <PlanSectionPanel key={s.code} section={s} userTargets={userTargets[s.code] || {}}
                            filter={filter} setCount={(bs, n) => setCount(s.code, bs, n)} />
                    ))}
                </div>

                <div className="px-5 py-3 border-t bg-gray-50 flex items-center gap-2">
                    <button onClick={onBack} disabled={generating}
                        className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-100">← Back</button>
                    <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
                        <span>Total picks across sections: <strong className="text-gray-800">{
                            preview.sections.reduce((t, s) => t + sumValues(userTargets[s.code]), 0)
                        }</strong></span>
                        <button onClick={onClose} disabled={generating}
                            className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-100">Cancel</button>
                        <button onClick={onGenerate} disabled={generating}
                            className="px-4 py-1.5 bg-green-600 text-white text-sm font-bold rounded hover:bg-green-700 disabled:opacity-50">
                            {generating ? 'Generating…' : 'Generate mock'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function sumValues(obj) {
    if (!obj) return 0;
    let n = 0;
    for (const v of Object.values(obj)) n += (parseInt(v || 0, 10) || 0);
    return n;
}

function PlanSectionPanel({ section, userTargets, filter, setCount }) {
    const [expanded, setExpanded] = useState(() => {
        // Default: expand only spec slugs that have nonzero user targets, or
        // any group with pool > 0 if user has nothing yet.
        const out = {};
        for (const slug of Object.keys(section.bank_pool_by_spec || {})) {
            out[slug] = Object.entries(userTargets).some(([, n]) =>
                n > 0 && (section.bank_pool_by_spec[slug] || []).some(c => c.bank_subtype === Object.keys(userTargets).find(bs => bs)));
        }
        // Fall back: expand top 4 spec slugs by total pool
        if (!Object.values(out).some(Boolean)) {
            const ordered = Object.entries(section.bank_pool_by_spec || {})
                .map(([slug, arr]) => ({ slug, total: arr.reduce((t, c) => t + c.pool, 0) }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 4);
            ordered.forEach(o => { out[o.slug] = true; });
        }
        return out;
    });

    const planned = sumValues(userTargets);
    const need = section.inventory_needed ?? 0;
    const status = planned === need ? 'on' : planned > need ? 'over' : 'under';

    const lowerFilter = filter.trim().toLowerCase();

    return (
        <div>
            <div className="text-xs text-gray-500 mb-3 flex flex-wrap gap-3">
                <span>Inventory needed: <strong className="text-gray-800">{need}</strong></span>
                <span>Placeholders: <strong>{section.placeholder_count}</strong></span>
                <span>Group slots: <strong>{section.group_slots}</strong></span>
                {section.code === 'ENGLISH' && section.group_availability && (
                    <>
                        <span title="RC groups meeting size + passage-length threshold">
                            RC qualifying: <strong className={section.group_availability.RC_qualifying > 0 ? 'text-gray-800' : 'text-red-700'}>
                                {section.group_availability.RC_qualifying ?? 0}
                            </strong>
                            <span className="text-gray-400"> / {section.group_availability.RC ?? 0} total</span>
                        </span>
                        <span title="Cloze groups meeting size + passage-length threshold">
                            Cloze qualifying: <strong className={section.group_availability.CLOZE_qualifying > 0 ? 'text-gray-800' : 'text-red-700'}>
                                {section.group_availability.CLOZE_qualifying ?? 0}
                            </strong>
                            <span className="text-gray-400"> / {section.group_availability.CLOZE ?? 0} total</span>
                        </span>
                    </>
                )}
                <span className={`ml-auto font-bold ${status === 'on' ? 'text-green-700' : status === 'over' ? 'text-red-700' : 'text-amber-700'}`}>
                    Plan total: {planned} / {need} {status === 'over' ? `(over by ${planned - need})` : status === 'under' ? `(short by ${need - planned})` : '✓'}
                </span>
            </div>

            <div className="space-y-2">
                {Object.entries(section.bank_pool_by_spec || {}).map(([slug, candidates]) => {
                    const slugTotal = candidates.reduce((t, c) => t + c.pool, 0);
                    const slugPlanned = candidates.reduce((t, c) => t + (userTargets[c.bank_subtype] || 0), 0);
                    const open = expanded[slug];

                    const visible = lowerFilter
                        ? candidates.filter(c => c.bank_subtype.toLowerCase().includes(lowerFilter) || slug.toLowerCase().includes(lowerFilter))
                        : candidates;
                    if (lowerFilter && visible.length === 0) return null;

                    return (
                        <div key={slug} className="border border-gray-200 rounded bg-white">
                            <button onClick={() => setExpanded(e => ({ ...e, [slug]: !e[slug] }))}
                                className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50">
                                <span className="flex items-center gap-2">
                                    <span className="text-gray-400">{open ? '▾' : '▸'}</span>
                                    <span className="font-mono font-semibold text-gray-800">{slug}</span>
                                    <span className="text-xs text-gray-500">({candidates.length} variations · pool {slugTotal})</span>
                                </span>
                                <span className="text-xs font-bold text-gray-700">picked {slugPlanned}</span>
                            </button>
                            {open && (
                                <div className="border-t border-gray-100 divide-y divide-gray-50">
                                    {visible.map(c => {
                                        const cur = userTargets[c.bank_subtype] || 0;
                                        const over = cur > c.pool;
                                        return (
                                            <div key={c.bank_subtype} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${over ? 'bg-red-50' : ''}`}>
                                                <span className="flex-1 min-w-0 font-mono truncate text-gray-700" title={c.bank_subtype}>{c.bank_subtype}</span>
                                                <span className="text-gray-500 w-16 text-right tabular-nums">
                                                    pool {c.pool}
                                                </span>
                                                <span className="text-gray-400 w-24 text-right tabular-nums font-mono text-[10px]" title="L1·L2·L3·L4 in pool">
                                                    {c.L1 ?? 0}·{c.L2 ?? 0}·{c.L3 ?? 0}·{c.L4 ?? 0}
                                                </span>
                                                <input type="number" min={0} max={c.pool}
                                                    value={cur}
                                                    onChange={e => setCount(c.bank_subtype, e.target.value)}
                                                    className={`w-16 text-sm border rounded px-2 py-1 text-right ${over ? 'border-red-400 bg-red-100 text-red-900' : 'border-gray-300'}`} />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ---------- Mock review (test-page-style two-column) ----------

function MockReview({ mockTestId, onChanged }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [busyKey, setBusyKey] = useState(null);
    const [fillTarget, setFillTarget] = useState(null); // { section_code, placeholder_id, position }
    const [browseTarget, setBrowseTarget] = useState(null); // { section_code, question_id_to_remove }

    // Quiet-reload tracking: first load shows the loading spinner; subsequent
    // reloads keep the current view (no flash) and restore scroll position.
    const isFirstLoad = useRef(true);
    const load = useCallback(async ({ silent = false } = {}) => {
        const scrollY = silent ? window.scrollY : null;
        if (!silent) setLoading(true);
        setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}`);
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Failed to load');
            setData(j);
            if (scrollY != null) {
                // restore scroll after React has painted the new data
                requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
            }
        } catch (e) { setErr(e.message); }
        finally { if (!silent) setLoading(false); isFirstLoad.current = false; }
    }, [mockTestId]);
    useEffect(() => { load(); }, [load]);

    const swap = async (question_id, opts = {}) => {
        setBusyKey(`swap-${question_id}`);
        setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}/swap`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id, ...opts }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Swap failed');
            await load({ silent: true }); onChanged?.();
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    // Local-patch edit. No reload — we already know exactly which fields
    // changed and the server confirmed them.
    const editQuestion = async (question_id, patch) => {
        setBusyKey(`edit-${question_id}`);
        setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}/edit-question`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id, ...patch }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Edit failed');
            setData(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    sections: prev.sections.map(sec => ({
                        ...sec,
                        items: sec.items.map(it => {
                            if (it.kind !== 'question' || it.question_id !== question_id) return it;
                            const next = { ...it };
                            if (typeof patch.stem === 'string') {
                                next.body_json = { ...(it.body_json || {}), text: patch.stem };
                            }
                            if (patch.options) {
                                next.options = { ...(it.options || {}) };
                                for (const [k, txt] of Object.entries(patch.options)) {
                                    next.options[k] = { ...(it.options?.[k] || {}), text: txt };
                                }
                            }
                            if (patch.correct_option_label) next.correct_option_label = patch.correct_option_label;
                            if (patch.difficulty != null) next.difficulty = patch.difficulty;
                            // Recompute has_image locally so the badge stays accurate
                            const combined = [next.body_json?.text || '',
                                ...['A', 'B', 'C', 'D'].map(k => next.options?.[k]?.text || '')].join(' ');
                            next.has_image = /\\includegraphics|!\[.*?\]\(.*?\)/.test(combined);
                            return next;
                        }),
                    })),
                };
            });
        } catch (e) { setErr(e.message); throw e; }
        finally { setBusyKey(null); }
    };

    // Passage edit (RC / Cloze stimulus). The passage is stored on a separate
    // question_version row referenced via group.passage_question_id, so it
    // needs its own endpoint distinct from edit-question.
    const editPassage = async (group_id, passage_text) => {
        setBusyKey(`passage-${group_id}`);
        setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}/edit-passage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_id, passage_text }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Passage edit failed');
            // Patch all items in this group locally so all 5 member cards show
            // the new passage immediately, no silent reload needed.
            setData(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    sections: prev.sections.map(sec => ({
                        ...sec,
                        items: sec.items.map(it => {
                            if (it.kind !== 'question' || it.group_id !== group_id) return it;
                            const next = { ...it };
                            const stimulus = it.stimulus || {};
                            const passage_body = stimulus.passage_body || {};
                            next.stimulus = {
                                ...stimulus,
                                passage_body: { ...passage_body, text: passage_text },
                            };
                            return next;
                        }),
                    })),
                };
            });
        } catch (e) { setErr(e.message); throw e; }
        finally { setBusyKey(null); }
    };

    const replaceWith = async (question_id_to_remove, replacement_question_id) => {
        setBusyKey(`replace-${question_id_to_remove}`);
        setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}/replace-with`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id_to_remove, replacement_question_id }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Replace failed');
            setBrowseTarget(null);
            await load({ silent: true }); onChanged?.();
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const junkQuestion = async (question_id) => {
        const reason = prompt('Why are you marking this question as JUNK? (optional)');
        if (reason === null) return; // user cancelled
        setBusyKey(`junk-${question_id}`);
        setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}/junk`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id, reason: reason || undefined }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Junk failed');
            await load({ silent: true }); onChanged?.();
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const fillWithExisting = async (placeholder_id, question_id) => {
        setBusyKey(`fill-${placeholder_id}`);
        setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}/fill-placeholder`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ placeholder_id, question_id }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Fill failed');
            await load({ silent: true }); onChanged?.();
            setFillTarget(null);
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const fillWithCa = async (placeholder_id, ca_payload) => {
        setBusyKey(`fill-${placeholder_id}`);
        setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}/fill-placeholder`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ placeholder_id, ca_payload }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Save failed');
            await load({ silent: true }); onChanged?.();
            setFillTarget(null);
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    // Defensive parse: server can occasionally return an empty body on a non-OK
    // response. Don't let JSON.parse blow up — surface the status code instead.
    const parseResponse = async (res) => {
        const text = await res.text();
        if (!text) return {};
        try { return JSON.parse(text); } catch { return { error: text.slice(0, 240) }; }
    };

    const approveAll = async () => {
        if (!confirm('Approve every question + mark this mock as APPROVED?')) return;
        setBusyKey('approve-all');
        setErr('');
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/approve-all`, { method: 'POST' });
            const j = await parseResponse(res);
            if (!res.ok || !j.success) throw new Error(j.error || `Approve failed (${res.status})`);
            await load({ silent: true }); onChanged?.();
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const publish = async () => {
        if (!confirm('Publish this mock? It will become a permanent record.')) return;
        setBusyKey('publish');
        setErr('');
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/publish`, { method: 'POST' });
            const j = await parseResponse(res);
            if (!res.ok) throw new Error(j.error || `Publish failed (${res.status})`);
            await load({ silent: true }); onChanged?.();
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const translateHindi = async () => {
        if (!confirm('Translate all GA / REASONING / QUANT questions to Hindi? This takes ~2-3 minutes.')) return;
        setBusyKey('translate-hi');
        setErr('');
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/translate-hindi`, { method: 'POST' });
            const j = await parseResponse(res);
            if (!res.ok || !j.success) throw new Error(j.error || `Translate failed (${res.status})`);
            await load({ silent: true });
            const c = j.counts || { processed: 0, failed: 0 };
            const msg = `Translated ${c.processed} questions${c.failed ? `, ${c.failed} failed` : ''}. Opening Hindi review…`;
            alert(msg);
            window.location.href = `/mock-tests/${mockTestId}/hindi-review`;
        } catch (e) { setErr(e.message); }
        finally { setBusyKey(null); }
    };

    const placeholderCount = useMemo(() => {
        if (!data) return 0;
        return data.sections.reduce((sum, s) => sum + s.items.filter(it => it.kind === 'placeholder').length, 0);
    }, [data]);

    if (loading) return <div className="p-6 text-gray-400">Loading mock…</div>;
    if (err) return <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{err}</div>;
    if (!data) return null;

    const { mock, sections } = data;
    const stats = mock.stats || {};
    const notes = Array.isArray(stats.notes) ? stats.notes : [];

    const scrollTo = (id) => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <div className="bg-gray-50 rounded-lg border border-gray-200">
            <div className="px-5 py-3 border-b bg-white flex items-center justify-between rounded-t-lg">
                <div>
                    <div className="font-bold text-gray-800">{mock.name}</div>
                    <div className="text-xs text-gray-500">
                        Status: <span className="font-semibold">{mock.status}</span> · {new Date(mock.created_at).toLocaleString()}
                        {placeholderCount > 0 && <span className="ml-2 text-amber-700 font-semibold">{placeholderCount} placeholder(s) unfilled</span>}
                    </div>
                </div>
                <div className="flex gap-2">
                    {(mock.status === 'DRAFT' || mock.status === 'IN_REVIEW') && (
                        <button onClick={approveAll}
                            disabled={busyKey === 'approve-all' || placeholderCount > 0}
                            title={placeholderCount > 0 ? `Fill the ${placeholderCount} placeholder(s) first` : 'Mark every question + the mock as APPROVED'}
                            className="px-3 py-1.5 bg-amber-600 text-white text-sm font-semibold rounded hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed">
                            {busyKey === 'approve-all' ? 'Approving…' : 'Approve all'}
                        </button>
                    )}
                    {mock.status === 'APPROVED' && (
                        <button onClick={publish}
                            disabled={busyKey === 'publish'}
                            className="px-3 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded hover:bg-blue-700 disabled:opacity-50">
                            {busyKey === 'publish' ? 'Publishing…' : 'Publish'}
                        </button>
                    )}
                    {(mock.status === 'APPROVED' || mock.status === 'PUBLISHED') && (
                        <>
                            <button onClick={translateHindi}
                                disabled={busyKey === 'translate-hi'}
                                title="Translate GA / REASONING / QUANT questions to Hindi (~2-3 min)"
                                className="px-3 py-1.5 bg-purple-600 text-white text-sm font-semibold rounded hover:bg-purple-700 disabled:opacity-50">
                                {busyKey === 'translate-hi' ? 'Translating…' : 'Translate to Hindi'}
                            </button>
                            <Link href={`/mock-tests/${mockTestId}/hindi-review`}
                                className="px-3 py-1.5 border border-purple-300 text-purple-700 text-sm font-semibold rounded hover:bg-purple-50">
                                Hindi review →
                            </Link>
                        </>
                    )}
                </div>
            </div>

            {notes.length > 0 && (
                <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
                    <div className="font-bold mb-0.5">Generation notes</div>
                    <ul className="list-disc pl-5">
                        {notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                </div>
            )}

            <SubtypeAnalysis sections={sections} />

            <div className="flex flex-col lg:flex-row items-start">
                {/* LHS sticky navigation */}
                <aside className="hidden lg:block w-72 sticky top-2 max-h-[calc(100vh-1rem)] overflow-y-auto p-3 shrink-0">
                    <div className="space-y-4">
                        {sections.map(sec => (
                            <SectionNav key={sec.code} section={sec} stats={stats} onJump={scrollTo} />
                        ))}
                    </div>
                </aside>

                {/* RHS main: scrollable question stream */}
                <main className="flex-1 p-3 space-y-4 min-w-0">
                    {sections.map(sec => (
                        <div key={sec.code} id={`section-${sec.code}`} className="bg-white rounded-lg border border-gray-200">
                            <div className="px-4 py-2 border-b bg-gray-50 flex items-center justify-between">
                                <h2 className="text-sm font-bold text-gray-800">
                                    {SECTION_LABELS[sec.code]} ({sec.items.length})
                                </h2>
                                <SectionStatBadge code={sec.code} stats={stats} />
                            </div>
                            <div className="p-3 space-y-2">
                                {sec.items.length === 0 && <div className="text-sm text-gray-400 italic">No items.</div>}
                                {sec.items.map((it, idx) => (
                                    <QuestionCard
                                        key={`${it.kind}-${it.position}-${it.question_id || it.placeholder_id}-${idx}`}
                                        item={it}
                                        sectionCode={sec.code}
                                        busyKey={busyKey}
                                        onSwap={swap}
                                        onEdit={editQuestion}
                                        onEditPassage={editPassage}
                                        onJunk={junkQuestion}
                                        onOpenBrowse={() => setBrowseTarget({ section_code: sec.code, question_id_to_remove: it.question_id })}
                                        onOpenFill={() => setFillTarget({ section_code: sec.code, placeholder_id: it.placeholder_id, position: it.position })}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </main>
            </div>

            {fillTarget && fillTarget.section_code === 'REASONING' && (
                <PyqPickerModal
                    onPick={(qid) => fillWithExisting(fillTarget.placeholder_id, qid)}
                    onClose={() => setFillTarget(null)}
                    busy={busyKey?.startsWith('fill-')}
                />
            )}
            {fillTarget && fillTarget.section_code === 'GA' && (
                <CaEditorModal
                    onSubmit={(payload) => fillWithCa(fillTarget.placeholder_id, payload)}
                    onClose={() => setFillTarget(null)}
                    busy={busyKey?.startsWith('fill-')}
                />
            )}
            {browseTarget && (
                <BankBrowserModal
                    section={browseTarget.section_code}
                    onPick={(qid) => replaceWith(browseTarget.question_id_to_remove, qid)}
                    onClose={() => setBrowseTarget(null)}
                    busy={busyKey?.startsWith('replace-')}
                />
            )}
        </div>
    );
}

// ---------- Subtype analysis (top-of-page at-a-glance view) ----------

const SECTION_LABEL_SHORT = { REASONING: 'REASONING', GA: 'GA', QUANT: 'QUANT', ENGLISH: 'ENGLISH' };

function SubtypeAnalysis({ sections }) {
    const [collapsed, setCollapsed] = useState(false);

    const analysis = useMemo(() => {
        return sections.map(sec => {
            const spec = SECTION_SPEC[sec.code] || {};
            const targets = spec.targets || {};
            const remainders = spec.remainder_subtypes || [];

            const questions = sec.items.filter(it => it.kind === 'question');
            const placeholderCount = sec.items.filter(it => it.kind === 'placeholder').length;

            // Picked: group items by slot_subtype, and inside each by bank subtype.
            const groups = new Map();
            for (const q of questions) {
                const slot = q.slot_subtype || '(unknown)';
                const fine = q.subtype || '(no subtype)';
                if (!groups.has(slot)) groups.set(slot, { picked: 0, fine: new Map() });
                const g = groups.get(slot);
                g.picked++;
                g.fine.set(fine, (g.fine.get(fine) || 0) + 1);
            }

            // Available pool: map each bank subtype to its derived spec slug and
            // collect pool counts grouped by spec slug.
            const poolBySlug = new Map(); // slot -> Map<bankSubtype, pool>
            for (const entry of (sec.bank_pool || [])) {
                const slot = specSlugForSubtype(entry.subtype) || '(uncategorised)';
                if (!poolBySlug.has(slot)) poolBySlug.set(slot, new Map());
                poolBySlug.get(slot).set(entry.subtype, entry.pool);
            }

            // Union of spec targets, remainders, picks, and pool slugs.
            const slugSet = new Set([
                ...Object.keys(targets),
                ...remainders,
                ...groups.keys(),
                ...poolBySlug.keys(),
            ]);

            const rows = [...slugSet].map(slug => {
                const g = groups.get(slug) || { picked: 0, fine: new Map() };
                const pool = poolBySlug.get(slug) || new Map();
                const target = targets[slug];
                const hasTarget = target != null;
                const delta = hasTarget ? g.picked - target : null;

                // Build a unified list of fine-grained bank subtypes (picked ∪ pool).
                const allBank = new Set([...g.fine.keys(), ...pool.keys()]);
                const fineRows = [...allBank].map(bankSubtype => ({
                    bankSubtype,
                    picked: g.fine.get(bankSubtype) || 0,
                    available: pool.get(bankSubtype) || 0,
                })).sort((a, b) => {
                    // picked first (highest count), then uncovered by largest pool
                    if (a.picked !== b.picked) return b.picked - a.picked;
                    return b.available - a.available;
                });

                return {
                    slug,
                    picked: g.picked,
                    target: hasTarget ? target : null,
                    delta,
                    isRemainder: !hasTarget,
                    fineRows,
                    uncoveredPool: [...pool.values()].reduce((s, n) => s + n, 0)
                                   - fineRows.filter(r => r.picked > 0).reduce((s, r) => s + r.available, 0),
                };
            }).sort((a, b) => {
                // Picked rows first (most filled at top), then 0-picked rows (uncovered) at bottom
                if ((a.picked > 0) !== (b.picked > 0)) return a.picked > 0 ? -1 : 1;
                return b.picked - a.picked || (b.uncoveredPool - a.uncoveredPool);
            });

            return {
                code: sec.code,
                totalQuestions: questions.length,
                placeholderCount,
                rows,
            };
        });
    }, [sections]);

    return (
        <div className="border-b border-gray-200 bg-white">
            <div className="px-5 py-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-700">Subtype analysis</h3>
                <button onClick={() => setCollapsed(c => !c)}
                    className="text-xs text-blue-600 hover:underline">
                    {collapsed ? 'Show' : 'Hide'}
                </button>
            </div>
            {!collapsed && (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 px-3 pb-3">
                    {analysis.map(a => (
                        <SubtypeAnalysisCard key={a.code} a={a} />
                    ))}
                </div>
            )}
        </div>
    );
}

function SubtypeAnalysisCard({ a }) {
    const [showAllUncovered, setShowAllUncovered] = useState({});
    const anyOver = a.rows.some(r => r.delta != null && r.delta > 0);

    return (
        <div className="border border-gray-200 rounded p-2 bg-white">
            <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-bold text-gray-800">{SECTION_LABEL_SHORT[a.code] || a.code}</span>
                <span className="text-[11px] text-gray-500">
                    {a.totalQuestions} q
                    {a.placeholderCount > 0 && <span className="text-amber-700"> +{a.placeholderCount} ph</span>}
                </span>
            </div>
            <div className="space-y-2">
                {a.rows.filter(r => r.picked > 0 || r.target != null || r.fineRows.some(f => f.available > 0)).map(r => {
                    const overBy = r.delta != null && r.delta > 0;
                    const underBy = r.delta != null && r.delta < 0;
                    const exact = r.delta === 0;
                    const noTarget = r.target == null;
                    const isEmpty = r.picked === 0;
                    const covered = r.fineRows.filter(f => f.picked > 0);
                    const uncovered = r.fineRows.filter(f => f.picked === 0 && f.available > 0)
                        .sort((a, b) => b.available - a.available);
                    const showAll = showAllUncovered[r.slug];
                    const uncoveredVisible = showAll ? uncovered : uncovered.slice(0, 5);
                    const extra = uncovered.length - uncoveredVisible.length;

                    return (
                        <div key={r.slug} className={`rounded border px-1.5 pt-1 pb-1
                            ${overBy ? 'border-red-300 bg-red-50'
                                : underBy ? 'border-amber-300 bg-amber-50'
                                : exact ? 'border-green-300 bg-green-50'
                                : isEmpty ? 'border-gray-200 bg-white opacity-90'
                                : noTarget ? 'border-gray-300 bg-gray-50'
                                : 'border-gray-100'}`}>
                            <div className="flex items-baseline justify-between text-[11px]">
                                <span className={`font-mono truncate ${isEmpty ? 'text-gray-500' : 'text-gray-800'}`} title={r.slug}>
                                    {r.slug}
                                    {noTarget && r.picked > 0 && <span className="ml-1 text-[10px] text-gray-400">(fallback)</span>}
                                    {isEmpty && r.target != null && <span className="ml-1 text-[10px] text-amber-600">missing</span>}
                                </span>
                                <span className={`font-bold ${overBy ? 'text-red-700' : underBy ? 'text-amber-700' : exact ? 'text-green-700' : isEmpty ? 'text-gray-400' : 'text-gray-700'}`}>
                                    {r.picked}{r.target != null && <span className="text-gray-400 font-normal">/{r.target}</span>}
                                    {overBy && <span className="ml-0.5 text-red-700">+{r.delta}</span>}
                                    {underBy && <span className="ml-0.5 text-amber-700">{r.delta}</span>}
                                </span>
                            </div>
                            {(covered.length > 0 || uncoveredVisible.length > 0) && (
                                <div className="mt-1 pl-2 border-l-2 border-gray-200 space-y-0.5">
                                    {covered.map(f => {
                                        const concern = f.picked >= 3 ? 'red' : f.picked === 2 ? 'amber' : null;
                                        return (
                                            <div key={f.bankSubtype}
                                                className={`flex items-baseline justify-between text-[10px] ${concern === 'red' ? 'text-red-700 font-semibold' : concern === 'amber' ? 'text-amber-700' : 'text-gray-600'}`}>
                                                <span className="font-mono truncate flex-1 min-w-0" title={f.bankSubtype}>{f.bankSubtype}</span>
                                                <span className="ml-1 font-bold tabular-nums">{f.picked}</span>
                                            </div>
                                        );
                                    })}
                                    {uncoveredVisible.length > 0 && (
                                        <>
                                            {covered.length > 0 && <div className="border-t border-gray-100 my-0.5"></div>}
                                            {uncoveredVisible.map(f => (
                                                <div key={f.bankSubtype}
                                                    className="flex items-baseline justify-between text-[10px] text-gray-400 italic"
                                                    title={`${f.bankSubtype} — ${f.available} available in the bank pool, not used yet`}>
                                                    <span className="font-mono truncate flex-1 min-w-0">{f.bankSubtype}</span>
                                                    <span className="ml-1 tabular-nums">·{f.available}</span>
                                                </div>
                                            ))}
                                            {extra > 0 && (
                                                <button onClick={() => setShowAllUncovered(s => ({ ...s, [r.slug]: true }))}
                                                    className="text-[10px] text-blue-600 hover:underline">
                                                    + {extra} more uncovered
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            {anyOver && (
                <div className="mt-2 text-[10px] text-red-700">
                    Red ≥ 3 of one fine-grained topic — use “Browse bank” to switch.
                </div>
            )}
            <div className="mt-1 text-[10px] text-gray-400">
                Italic gray rows · count = uncovered in the bank pool.
            </div>
        </div>
    );
}

function SectionStatBadge({ code, stats }) {
    const s = (stats?.section_stats || []).find(x => x.code === code);
    if (!s) return null;
    const target = s.difficulty_target || null;
    const actual = s.difficulty_actual || s.difficulty || {};
    const levelChip = (lvl) => {
        const a = actual[`L${lvl}`] ?? 0;
        const t = target ? (target[`L${lvl}`] ?? 0) : null;
        const diff = t != null ? a - t : null;
        let cls = 'text-gray-500';
        let title = `got ${a}`;
        if (t != null) {
            title = `target ${t}, got ${a}`;
            if (diff === 0) cls = 'text-gray-700';
            else if (Math.abs(diff) === 1) cls = 'text-amber-700';
            else cls = 'text-red-700 font-bold';
        }
        return (
            <span key={lvl} className={cls} title={title}>
                L{lvl}:{a}{t != null ? `/${t}` : ''}
            </span>
        );
    };
    return (
        <span className="text-xs text-gray-600 inline-flex gap-2 items-baseline">
            <span>{s.drawn || 0}/{s.target}</span>
            {s.placeholder_count > 0 && <span className="text-amber-700">+{s.placeholder_count}ph</span>}
            <span className="inline-flex gap-1.5">{DIFFICULTY_LEVELS.map(levelChip)}</span>
        </span>
    );
}

function SectionNav({ section, stats, onJump }) {
    const s = (stats?.section_stats || []).find(x => x.code === section.code);
    return (
        <div className="bg-white rounded border border-gray-200 p-2">
            <button onClick={() => onJump(`section-${section.code}`)}
                className="w-full text-left mb-2">
                <div className="text-xs font-bold text-gray-700">{section.code}</div>
                {s && <div className="text-[10px] text-gray-500">
                    {s.drawn || 0}/{s.target}
                    {s.placeholder_count > 0 && <span className="text-amber-700"> · {s.placeholder_count}ph</span>}
                </div>}
            </button>
            <div className="grid grid-cols-5 gap-1">
                {section.items.map((it, idx) => {
                    const isPh = it.kind === 'placeholder';
                    const isGroup = it.group_id;
                    const colors = isPh
                        ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
                        : isGroup
                            ? 'bg-purple-100 text-purple-800 border-purple-300 hover:bg-purple-200'
                            : 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100';
                    return (
                        <button key={idx} onClick={() => onJump(`q-${section.code}-${it.position}`)}
                            className={`text-[10px] font-bold border rounded px-1 py-1.5 ${colors}`}
                            title={isPh ? it.placeholder_id : `Q.${it.position} · ${it.subtype}`}>
                            {it.position}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function specSubtypesForSection(code) {
    const spec = SECTION_SPEC[code] || {};
    const set = new Set([
        ...Object.keys(spec.targets || {}),
        ...(spec.remainder_subtypes || []),
    ]);
    return [...set].sort();
}

function QuestionCard({ item, sectionCode, busyKey, onSwap, onEdit, onEditPassage, onJunk, onOpenBrowse, onOpenFill }) {
    const anchor = `q-${sectionCode}-${item.position}`;
    const [editing, setEditing] = useState(false);
    const [draftStem, setDraftStem] = useState('');
    const [draftOpts, setDraftOpts] = useState({ A: '', B: '', C: '', D: '' });
    const [draftCorrect, setDraftCorrect] = useState('A');
    const [draftDifficulty, setDraftDifficulty] = useState(2);
    const [editErr, setEditErr] = useState('');
    const [uploadingTo, setUploadingTo] = useState(null); // 'stem' | 'A' | 'B' | 'C' | 'D' | null

    // Inline passage editor (RC / Cloze stimulus)
    const [editingPassage, setEditingPassage] = useState(false);
    const [draftPassage, setDraftPassage] = useState('');
    const [savingPassage, setSavingPassage] = useState(false);

    // Split-button swap menu (override spec_subtype / difficulty)
    const [swapMenuOpen, setSwapMenuOpen] = useState(false);
    const [overrideSubtype, setOverrideSubtype] = useState('');
    const [overrideDifficulty, setOverrideDifficulty] = useState('');
    const swapMenuRef = useRef(null);
    useEffect(() => {
        if (!swapMenuOpen) return;
        const onDocMouseDown = (e) => {
            if (swapMenuRef.current && !swapMenuRef.current.contains(e.target)) {
                setSwapMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onDocMouseDown);
        return () => document.removeEventListener('mousedown', onDocMouseDown);
    }, [swapMenuOpen]);

    if (item.kind === 'placeholder') {
        const isReasoning = sectionCode === 'REASONING';
        const isFilling = busyKey === `fill-${item.placeholder_id}`;
        return (
            <div id={anchor} className="border-2 border-dashed border-amber-300 bg-amber-50 rounded p-3 flex items-center gap-3">
                <span className="text-xs font-bold text-amber-700">#{item.position}</span>
                <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-900 text-xs font-mono">{item.placeholder_id}</span>
                <span className="text-amber-700 text-xs flex-1">
                    {isReasoning ? 'Visual reasoning slot — pick a PYQ image question.' : 'Current-affairs slot — add manually.'}
                </span>
                <button onClick={onOpenFill} disabled={isFilling}
                    className="text-xs font-semibold px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                    {isFilling ? '…' : isReasoning ? 'Pick PYQ image →' : 'Add CA question →'}
                </button>
            </div>
        );
    }

    const isSwapping = busyKey === `swap-${item.question_id}`;
    const isEditing = editing;
    const isSavingEdit = busyKey === `edit-${item.question_id}`;
    const opts = item.options || {};

    const startEdit = () => {
        setDraftStem(item.body_json?.text || '');
        setDraftOpts({
            A: opts.A?.text || '',
            B: opts.B?.text || '',
            C: opts.C?.text || '',
            D: opts.D?.text || '',
        });
        setDraftCorrect(item.correct_option_label || 'A');
        setDraftDifficulty(item.difficulty ?? 2);
        setEditErr('');
        setEditing(true);
    };

    // Upload an image (File blob) and append \includegraphics{path} to the
    // chosen field's draft. `target` is 'stem' or one of 'A'/'B'/'C'/'D'.
    const uploadImage = async (fileBlob, target) => {
        if (!fileBlob || !item.question_id || !item.version_no) return;
        setUploadingTo(target);
        setEditErr('');
        try {
            const reader = new FileReader();
            const dataUrl = await new Promise((resolve, reject) => {
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(fileBlob);
            });
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: dataUrl,
                    question_id: item.question_id,
                    language: item.language || 'EN',
                    version_no: item.version_no,
                    role: target === 'stem' ? 'stem' : 'option',
                    option_key: target === 'stem' ? '__STEM__' : target,
                }),
            });
            const data = await res.json();
            if (!data.latexPath) throw new Error(data.error || 'Upload failed');
            const tag = `\\includegraphics{${data.latexPath}}`;
            if (target === 'stem') {
                setDraftStem(prev => (prev ? `${prev}\n\n${tag}` : tag));
            } else {
                setDraftOpts(prev => ({ ...prev, [target]: prev[target] ? `${prev[target]} ${tag}` : tag }));
            }
        } catch (e) {
            setEditErr(e.message);
        } finally {
            setUploadingTo(null);
        }
    };

    const handlePaste = (e, target) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const it of items) {
            if (it.type && it.type.startsWith('image/')) {
                e.preventDefault();
                uploadImage(it.getAsFile(), target);
                return;
            }
        }
    };
    const cancelEdit = () => { setEditing(false); setEditErr(''); };
    const saveEdit = async () => {
        const patch = {};
        if (draftStem !== (item.body_json?.text || '')) patch.stem = draftStem;
        const optsPatch = {};
        for (const k of ['A', 'B', 'C', 'D']) {
            if (draftOpts[k] !== (opts[k]?.text || '')) optsPatch[k] = draftOpts[k];
        }
        if (Object.keys(optsPatch).length > 0) patch.options = optsPatch;
        if (draftCorrect !== (item.correct_option_label || null)) patch.correct_option_label = draftCorrect;
        if (draftDifficulty !== (item.difficulty ?? null)) patch.difficulty = draftDifficulty;
        if (Object.keys(patch).length === 0) { setEditing(false); return; }
        try {
            await onEdit(item.question_id, patch);
            setEditing(false);
        } catch (e) { setEditErr(e.message); }
    };

    return (
        <div id={anchor} className="border border-gray-200 rounded p-3 bg-white">
            <div className="flex items-center gap-2 mb-2 flex-wrap text-xs">
                <span className="font-bold text-gray-500">#{item.position}</span>
                {item.group_id && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                        {item.stimulus?.group_type || 'GROUP'}
                    </span>
                )}
                <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono text-[11px]">{item.subtype || '?'}</span>
                <span className={`px-1.5 py-0.5 rounded font-bold text-[11px]
                    ${item.difficulty === 2 ? 'bg-green-100 text-green-700'
                        : item.difficulty === 3 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                    L{item.difficulty}
                </span>
                <span className="text-gray-500">answer: <span className="font-bold">{item.correct_option_label}</span></span>
                <div className="ml-auto flex gap-2">
                    {!isEditing && (
                        <button onClick={startEdit}
                            className="text-xs font-semibold px-2 py-1 rounded border border-blue-300 text-blue-700 bg-white hover:bg-blue-50">
                            Edit
                        </button>
                    )}
                    {item.group_id ? (
                        <button onClick={() => onSwap(item.question_id)} disabled={isSwapping || isEditing}
                            title="Swap with another group of the same type"
                            className="text-xs font-semibold px-2 py-1 rounded border border-red-300 text-red-700 bg-white hover:bg-red-50 disabled:opacity-50">
                            {isSwapping ? '…' : 'Swap group'}
                        </button>
                    ) : (
                        <div className="relative inline-flex" ref={swapMenuRef}>
                            <button onClick={() => onSwap(item.question_id)} disabled={isSwapping || isEditing}
                                title="Swap with another question of the same subtype family"
                                className="text-xs font-semibold px-2 py-1 rounded-l border border-red-300 text-red-700 bg-white hover:bg-red-50 disabled:opacity-50">
                                {isSwapping ? '…' : 'Delete & swap'}
                            </button>
                            <button onClick={() => setSwapMenuOpen(o => !o)} disabled={isSwapping || isEditing}
                                title="Swap with a different subtype or difficulty"
                                aria-label="Swap options"
                                className="text-xs font-semibold px-1.5 py-1 rounded-r border border-l-0 border-red-300 text-red-700 bg-white hover:bg-red-50 disabled:opacity-50">
                                ▾
                            </button>
                            {swapMenuOpen && (
                                <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-md shadow-lg p-3 w-72">
                                    <div className="text-[10px] font-bold text-gray-500 uppercase mb-2">Swap with different…</div>
                                    <label className="block mb-2">
                                        <span className="text-[10px] font-semibold text-gray-600 uppercase">Spec subtype</span>
                                        <select value={overrideSubtype}
                                            onChange={e => setOverrideSubtype(e.target.value)}
                                            className="w-full text-xs border border-gray-300 rounded px-2 py-1 mt-0.5">
                                            <option value="">(same family — {item.slot_subtype || '?'})</option>
                                            {specSubtypesForSection(sectionCode).map(s => (
                                                <option key={s} value={s}>{s}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block mb-3">
                                        <span className="text-[10px] font-semibold text-gray-600 uppercase">Difficulty</span>
                                        <select value={overrideDifficulty}
                                            onChange={e => setOverrideDifficulty(e.target.value)}
                                            className="w-full text-xs border border-gray-300 rounded px-2 py-1 mt-0.5">
                                            <option value="">(same level — L{item.difficulty})</option>
                                            {DIFFICULTY_LEVELS.map(l => (
                                                <option key={l} value={l}>L{l}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <div className="flex gap-2 justify-end">
                                        <button onClick={() => { setSwapMenuOpen(false); setOverrideSubtype(''); setOverrideDifficulty(''); }}
                                            className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
                                        <button onClick={() => {
                                            const opts = {};
                                            if (overrideSubtype) opts.target_spec_subtype = overrideSubtype;
                                            if (overrideDifficulty) opts.target_difficulty = parseInt(overrideDifficulty, 10);
                                            setSwapMenuOpen(false);
                                            onSwap(item.question_id, opts);
                                            setOverrideSubtype(''); setOverrideDifficulty('');
                                        }}
                                            disabled={!overrideSubtype && !overrideDifficulty}
                                            className="text-xs px-3 py-1 rounded bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
                                            Swap →
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {!isEditing && !item.group_id && (
                        <button onClick={onOpenBrowse}
                            disabled={busyKey === `replace-${item.question_id}`}
                            title="Browse the bank to pick a replacement from a different topic"
                            className="text-xs font-semibold px-2 py-1 rounded border border-amber-400 text-amber-700 bg-white hover:bg-amber-50 disabled:opacity-50">
                            {busyKey === `replace-${item.question_id}` ? '…' : 'Browse bank'}
                        </button>
                    )}
                    {!isEditing && (
                        <button onClick={() => onJunk?.(item.question_id)}
                            disabled={busyKey === `junk-${item.question_id}`}
                            title="Mark this question as JUNK so it never reappears in any future mock"
                            className="text-xs font-semibold px-2 py-1 rounded border border-gray-700 text-gray-900 bg-white hover:bg-gray-900 hover:text-white disabled:opacity-50">
                            {busyKey === `junk-${item.question_id}` ? '…' : 'Mark JUNK'}
                        </button>
                    )}
                </div>
            </div>

            {item.stimulus?.passage_body?.text != null && item.group_id && (
                <div className="mb-2 p-3 bg-purple-50 border border-purple-200 rounded text-sm">
                    <div className="flex items-baseline justify-between mb-1">
                        <div className="text-[10px] font-bold text-purple-700 uppercase">Passage / Stimulus</div>
                        {!editingPassage ? (
                            <button onClick={() => {
                                setDraftPassage(item.stimulus.passage_body.text || '');
                                setEditingPassage(true);
                            }}
                                className="text-[10px] font-semibold text-purple-700 hover:underline">
                                Edit passage
                            </button>
                        ) : (
                            <div className="flex gap-1.5">
                                <button onClick={() => setEditingPassage(false)} disabled={savingPassage}
                                    className="text-[10px] px-2 py-0.5 border border-gray-300 rounded text-gray-700 hover:bg-white disabled:opacity-50">
                                    Cancel
                                </button>
                                <button onClick={async () => {
                                    if (!onEditPassage) return;
                                    setSavingPassage(true);
                                    try {
                                        await onEditPassage(item.group_id, draftPassage);
                                        setEditingPassage(false);
                                    } catch { /* error surfaces in parent */ }
                                    finally { setSavingPassage(false); }
                                }} disabled={savingPassage}
                                    className="text-[10px] px-2 py-0.5 bg-purple-600 text-white rounded font-bold hover:bg-purple-700 disabled:opacity-50">
                                    {savingPassage ? 'Saving…' : 'Save passage'}
                                </button>
                            </div>
                        )}
                    </div>
                    {!editingPassage ? (
                        <Latex>{item.stimulus.passage_body.text}</Latex>
                    ) : (
                        <textarea value={draftPassage}
                            onChange={e => setDraftPassage(e.target.value)}
                            rows={Math.max(4, Math.min(20, Math.ceil((draftPassage.length || 0) / 80)))}
                            className="w-full font-mono text-xs border border-purple-300 rounded p-2 bg-white" />
                    )}
                    {editingPassage && (
                        <div className="text-[10px] text-purple-600 mt-1">
                            Saves the EN passage for this group. All {item.stimulus?.group_type || 'group'} questions sharing this passage will update.
                        </div>
                    )}
                </div>
            )}

            {!isEditing ? (
                <>
                    <div className="p-3 bg-gray-50 border border-gray-100 rounded text-sm">
                        <Latex>{item.body_json?.text || ''}</Latex>
                    </div>
                    <div className="space-y-1.5 mt-2">
                        {['A', 'B', 'C', 'D'].map(k => (
                            <div key={k} className={`flex gap-2 p-2 rounded border text-sm
                                ${item.correct_option_label === k ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'}`}>
                                <span className="font-bold text-gray-700">{k}.</span>
                                <div className="flex-1"><Latex>{opts[k]?.text || ''}</Latex></div>
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <div className="space-y-2">
                    <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        ⚠ Editing updates the source question in place — bank questions are shared across other uses.
                    </div>
                    <div>
                        <div className="flex items-baseline justify-between">
                            <span className="text-[10px] font-bold text-gray-500 uppercase">Stem</span>
                            <ImageUploadButton target="stem" uploadingTo={uploadingTo}
                                onPick={(file) => uploadImage(file, 'stem')} />
                        </div>
                        <textarea rows={3} value={draftStem}
                            onChange={e => setDraftStem(e.target.value)}
                            onPaste={(e) => handlePaste(e, 'stem')}
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mt-0.5 font-mono" />
                    </div>
                    {['A', 'B', 'C', 'D'].map(k => (
                        <div key={k}>
                            <div className="flex items-baseline justify-between">
                                <span className="text-[10px] font-bold text-gray-500 uppercase">Option {k}</span>
                                <ImageUploadButton target={k} uploadingTo={uploadingTo}
                                    onPick={(file) => uploadImage(file, k)} />
                            </div>
                            <input type="text" value={draftOpts[k]}
                                onChange={e => setDraftOpts(o => ({ ...o, [k]: e.target.value }))}
                                onPaste={(e) => handlePaste(e, k)}
                                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mt-0.5 font-mono" />
                        </div>
                    ))}
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[10px] font-bold text-gray-500 uppercase">Correct</span>
                        <div className="flex gap-1">
                            {['A', 'B', 'C', 'D'].map(k => (
                                <button key={k} onClick={() => setDraftCorrect(k)}
                                    className={`w-8 h-8 rounded border font-bold text-xs
                                        ${draftCorrect === k ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>{k}</button>
                            ))}
                        </div>
                        <span className="text-[10px] font-bold text-gray-500 uppercase ml-3">Difficulty</span>
                        <div className="flex gap-1">
                            {[1, 2, 3, 4].map(d => (
                                <button key={d} onClick={() => setDraftDifficulty(d)}
                                    className={`px-2.5 py-1 rounded border font-bold text-[11px]
                                        ${draftDifficulty === d
                                            ? (d === 2 ? 'border-green-500 bg-green-50 text-green-700'
                                                : d === 3 ? 'border-orange-500 bg-orange-50 text-orange-700'
                                                    : 'border-gray-500 bg-gray-100 text-gray-700')
                                            : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>
                                    L{d}
                                </button>
                            ))}
                        </div>
                        <div className="ml-auto flex gap-2">
                            <button onClick={cancelEdit} disabled={isSavingEdit}
                                className="text-xs px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-100">Cancel</button>
                            <button onClick={saveEdit} disabled={isSavingEdit}
                                className="text-xs px-4 py-1.5 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 disabled:opacity-50">
                                {isSavingEdit ? 'Saving…' : 'Save changes'}
                            </button>
                        </div>
                    </div>
                    {editErr && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{editErr}</div>}
                </div>
            )}
        </div>
    );
}

// ---------- Visual reasoning picker ----------

function PyqPickerModal({ onPick, onClose, busy }) {
    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [chosenId, setChosenId] = useState(null);
    const debounceRef = useRef(null);

    useEffect(() => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setDebouncedQ(q), 350);
        return () => clearTimeout(debounceRef.current);
    }, [q]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true); setErr('');
            try {
                const res = await fetch(`/api/cgl-mock/search-pyq?kind=visual_reasoning&q=${encodeURIComponent(debouncedQ)}&limit=20`);
                const j = await res.json();
                if (cancelled) return;
                if (!res.ok || !j.success) throw new Error(j.error || 'Search failed');
                setRows(j.rows); setTotal(j.total);
            } catch (e) { if (!cancelled) setErr(e.message); }
            finally { if (!cancelled) setLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [debouncedQ]);

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                <div className="px-5 py-3 border-b flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold">Pick a visual-reasoning PYQ</h2>
                        <p className="text-xs text-gray-500">Verified PYQ image questions, not used in any prior CGL T1 mock.</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-800 text-xl">&times;</button>
                </div>
                <div className="px-5 py-2 border-b">
                    <input type="text" value={q} onChange={e => setQ(e.target.value)}
                        placeholder="Search stems… (e.g. 'cube', 'water image', 'mirror')"
                        className="w-full text-sm border border-gray-300 rounded px-3 py-1.5" />
                    <div className="text-[11px] text-gray-500 mt-1">
                        {loading ? 'Searching…' : `${total} matches`}
                    </div>
                </div>
                {err && <div className="mx-5 mt-3 p-2 bg-red-50 text-red-700 text-xs border border-red-200 rounded">{err}</div>}
                <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
                    {rows.length === 0 && !loading && (
                        <div className="text-center text-gray-400 text-sm p-6">No matches.</div>
                    )}
                    {rows.map(r => (
                        <button key={r.question_id} onClick={() => setChosenId(r.question_id)}
                            className={`block w-full text-left rounded border p-3 text-sm
                                ${chosenId === r.question_id ? 'border-green-500 ring-2 ring-green-300 bg-green-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                            <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
                                <span className="font-mono">{r.section_code}</span>
                                <span className="px-1.5 py-0 rounded bg-gray-100">{r.exam_code || '?'}</span>
                                <span>{r.paper_date ? new Date(r.paper_date).toLocaleDateString() : ''}</span>
                                <span>L{r.difficulty}</span>
                                <span className="font-mono text-gray-300 ml-auto">{r.question_id.slice(0, 8)}</span>
                            </div>
                            <div className="prose prose-sm max-w-none"><Latex>{r.body_json?.text || ''}</Latex></div>
                            <div className="grid grid-cols-2 gap-1 mt-2">
                                {['A', 'B', 'C', 'D'].map(k => (
                                    <div key={k} className={`text-xs p-1.5 rounded border
                                        ${r.correct_option_label === k ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                                        <span className="font-bold">{k}.</span> <Latex>{r.options?.[k]?.text || ''}</Latex>
                                    </div>
                                ))}
                            </div>
                        </button>
                    ))}
                </div>
                <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-end gap-2">
                    <button onClick={onClose} disabled={busy}
                        className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-100">Cancel</button>
                    <button onClick={() => chosenId && onPick(chosenId)}
                        disabled={!chosenId || busy}
                        className="px-4 py-1.5 bg-green-600 text-white text-sm font-bold rounded hover:bg-green-700 disabled:opacity-50">
                        {busy ? 'Saving…' : 'Use this question'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------- Current-affairs manual entry ----------

function CaEditorModal({ onSubmit, onClose, busy }) {
    const [stem, setStem] = useState('');
    const [options, setOptions] = useState({ A: '', B: '', C: '', D: '' });
    const [correct, setCorrect] = useState('A');
    const [difficulty, setDifficulty] = useState(2);
    const valid = stem.trim() && correct && ['A', 'B', 'C', 'D'].every(k => options[k].trim());

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
                <div className="px-5 py-3 border-b flex items-center justify-between">
                    <h2 className="text-lg font-bold">Add current-affairs question</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-800 text-xl">&times;</button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                    <label className="block">
                        <span className="text-xs font-semibold text-gray-600 uppercase">Question stem</span>
                        <textarea rows={3} value={stem} onChange={e => setStem(e.target.value)}
                            className="w-full mt-1 text-sm border border-gray-300 rounded px-2 py-1.5 font-mono"
                            placeholder="Write the question. Latex inside $…$ works." />
                    </label>
                    {['A', 'B', 'C', 'D'].map(k => (
                        <label key={k} className="block">
                            <span className="text-xs font-semibold text-gray-600 uppercase">Option {k}</span>
                            <input type="text" value={options[k]}
                                onChange={e => setOptions(o => ({ ...o, [k]: e.target.value }))}
                                className="w-full mt-1 text-sm border border-gray-300 rounded px-2 py-1.5" />
                        </label>
                    ))}
                    <div className="flex items-center gap-4 pt-2">
                        <div>
                            <div className="text-xs font-semibold text-gray-600 uppercase mb-1">Correct option</div>
                            <div className="flex gap-1">
                                {['A', 'B', 'C', 'D'].map(k => (
                                    <button key={k} onClick={() => setCorrect(k)}
                                        className={`w-9 h-9 rounded border font-bold text-sm
                                            ${correct === k ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>{k}</button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="text-xs font-semibold text-gray-600 uppercase mb-1">Difficulty</div>
                            <div className="flex gap-1">
                                {[2, 3].map(d => (
                                    <button key={d} onClick={() => setDifficulty(d)}
                                        className={`px-3 py-1.5 rounded border font-bold text-xs
                                            ${difficulty === d ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>
                                        L{d}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-end gap-2">
                    <button onClick={onClose} disabled={busy}
                        className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-100">Cancel</button>
                    <button onClick={() => onSubmit({ stem, options, correct_option_label: correct, difficulty })}
                        disabled={!valid || busy}
                        className="px-4 py-1.5 bg-green-600 text-white text-sm font-bold rounded hover:bg-green-700 disabled:opacity-50">
                        {busy ? 'Saving…' : 'Save & insert'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------- Image upload helper (file picker + paste-aware label) ----------

function ImageUploadButton({ target, uploadingTo, onPick }) {
    const inputRef = useRef(null);
    const isUploading = uploadingTo === target;
    return (
        <>
            <button type="button" onClick={() => inputRef.current?.click()}
                disabled={uploadingTo !== null}
                title="Upload an image — also accepts Ctrl+V paste into the field"
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-blue-300 text-blue-700 bg-white hover:bg-blue-50 disabled:opacity-50">
                {isUploading ? 'Uploading…' : '📎 Add image'}
            </button>
            <input ref={inputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPick(f);
                    e.target.value = '';
                }} />
        </>
    );
}

// ---------- Bank browser (swap to a different topic / subtype) ----------

function BankBrowserModal({ section, onPick, onClose, busy }) {
    const [specSubtype, setSpecSubtype] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [buckets, setBuckets] = useState([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [chosenId, setChosenId] = useState(null);
    const debounceRef = useRef(null);

    useEffect(() => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setDebouncedQ(q), 350);
        return () => clearTimeout(debounceRef.current);
    }, [q]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true); setErr('');
            try {
                const qs = new URLSearchParams({ section, limit: '20' });
                if (specSubtype) qs.set('spec_subtype', specSubtype);
                if (difficulty) qs.set('difficulty', difficulty);
                if (debouncedQ) qs.set('q', debouncedQ);
                const res = await fetch(`/api/cgl-mock/search-bank?${qs}`);
                const j = await res.json();
                if (cancelled) return;
                if (!res.ok || !j.success) throw new Error(j.error || 'Search failed');
                setRows(j.rows); setTotal(j.total); setBuckets(j.subtype_buckets || []);
            } catch (e) { if (!cancelled) setErr(e.message); }
            finally { if (!cancelled) setLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [section, specSubtype, difficulty, debouncedQ]);

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                <div className="px-5 py-3 border-b flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold">Pick a replacement from {section}</h2>
                        <p className="text-xs text-gray-500">
                            Verified bank pool, excludes anything in any prior CGL T1 mock.
                            Choose a different subtype to fix topic concentration.
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-800 text-xl">&times;</button>
                </div>
                <div className="px-5 py-2 border-b space-y-2">
                    <div className="flex gap-2 items-center flex-wrap">
                        <label className="text-xs font-semibold text-gray-600 uppercase">Subtype</label>
                        <select value={specSubtype} onChange={e => setSpecSubtype(e.target.value)}
                            className="text-sm border border-gray-300 rounded px-2 py-1 min-w-[200px]">
                            <option value="">Any</option>
                            {buckets.map(b => (
                                <option key={b.slug} value={b.slug} disabled={b.count === 0}>
                                    {b.slug} ({b.count})
                                </option>
                            ))}
                        </select>
                        <label className="text-xs font-semibold text-gray-600 uppercase ml-2">Difficulty</label>
                        <div className="flex gap-1">
                            {[['', 'Both'], ['2', 'L2'], ['3', 'L3']].map(([v, label]) => (
                                <button key={v || 'any'} onClick={() => setDifficulty(v)}
                                    className={`text-[11px] font-bold px-2 py-1 rounded border
                                        ${difficulty === v ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <input type="text" value={q} onChange={e => setQ(e.target.value)}
                        placeholder="Search stems…"
                        className="w-full text-sm border border-gray-300 rounded px-3 py-1.5" />
                    <div className="text-[11px] text-gray-500">{loading ? 'Searching…' : `${total} matches`}</div>
                </div>
                {err && <div className="mx-5 mt-3 p-2 bg-red-50 text-red-700 text-xs border border-red-200 rounded">{err}</div>}
                <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
                    {rows.length === 0 && !loading && (
                        <div className="text-center text-gray-400 text-sm p-6">No matches.</div>
                    )}
                    {rows.map(r => (
                        <button key={r.question_id} onClick={() => setChosenId(r.question_id)}
                            className={`block w-full text-left rounded border p-3 text-sm
                                ${chosenId === r.question_id ? 'border-green-500 ring-2 ring-green-300 bg-green-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                            <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1 flex-wrap">
                                <span className="font-mono px-1.5 py-0 rounded bg-indigo-50 text-indigo-700">{r.subtype}</span>
                                <span className={`px-1.5 py-0 rounded font-bold
                                    ${r.difficulty === 2 ? 'bg-green-100 text-green-700' : r.difficulty === 3 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                                    L{r.difficulty}
                                </span>
                                {r.variation && <span className="text-gray-500">var: {r.variation}</span>}
                                <span className="ml-auto font-mono text-gray-300">{r.question_id.slice(0, 8)}</span>
                            </div>
                            <div className="prose prose-sm max-w-none"><Latex>{r.body_json?.text || ''}</Latex></div>
                            <div className="grid grid-cols-2 gap-1 mt-2">
                                {['A', 'B', 'C', 'D'].map(k => (
                                    <div key={k} className={`text-xs p-1.5 rounded border
                                        ${r.correct_option_label === k ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                                        <span className="font-bold">{k}.</span> <Latex>{r.options?.[k]?.text || ''}</Latex>
                                    </div>
                                ))}
                            </div>
                        </button>
                    ))}
                </div>
                <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-end gap-2">
                    <button onClick={onClose} disabled={busy}
                        className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-100">Cancel</button>
                    <button onClick={() => chosenId && onPick(chosenId)}
                        disabled={!chosenId || busy}
                        className="px-4 py-1.5 bg-amber-600 text-white text-sm font-bold rounded hover:bg-amber-700 disabled:opacity-50">
                        {busy ? 'Replacing…' : 'Use this question'}
                    </button>
                </div>
            </div>
        </div>
    );
}
