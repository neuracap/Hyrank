'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Latex from '@/components/Latex';

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
    ga_ca_placeholder_count: 4,
};

export default function CglMockBuilder() {
    const [drafts, setDrafts] = useState([]);
    const [loadingList, setLoadingList] = useState(false);
    const [error, setError] = useState('');

    const [showConfig, setShowConfig] = useState(false);
    const [config, setConfig] = useState(DEFAULT_CONFIG);
    const [mockName, setMockName] = useState('');
    const [generating, setGenerating] = useState(false);

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

    const generate = async () => {
        setGenerating(true);
        setError('');
        try {
            const body = { ...config };
            if (mockName.trim()) body.name = mockName.trim();
            const res = await fetch('/api/cgl-mock/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Generate failed');
            setShowConfig(false);
            setMockName('');
            await fetchDrafts();
            setSelectedId(data.mock_test_id);
        } catch (e) { setError(e.message); }
        finally { setGenerating(false); }
    };

    return (
        <div className="container mx-auto px-4 py-6 max-w-7xl">
            <header className="mb-5 flex items-center justify-between border-b pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">SSC CGL Tier 1 — Mock Builder</h1>
                    <p className="text-gray-500 text-sm mt-0.5">
                        Generates a draft mock from the verified bank (source_type=bank,
                        verified). Excludes questions used in any prior CGL T1 mock.
                    </p>
                </div>
                <div className="flex gap-3 items-center">
                    <Link href="/mock-test-builder" className="text-blue-600 hover:text-blue-800 text-sm">← General builder</Link>
                    <button onClick={() => setShowConfig(true)}
                        className="px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-md hover:bg-green-700">
                        + Make new mock test
                    </button>
                </div>
            </header>

            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

            {/* drafts list */}
            <div className="mb-6">
                <h2 className="text-sm font-bold text-gray-600 uppercase tracking-wide mb-2">Drafts</h2>
                {loadingList && <div className="text-sm text-gray-400">Loading…</div>}
                {!loadingList && drafts.length === 0 && (
                    <div className="text-sm text-gray-500 bg-white border border-gray-200 rounded p-4">
                        No drafts yet. Click <em>Make new mock test</em> to start.
                    </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {drafts.map(d => (
                        <button key={d.mock_test_id} onClick={() => setSelectedId(d.mock_test_id)}
                            className={`text-left p-3 rounded border transition-colors
                                ${selectedId === d.mock_test_id ? 'bg-blue-50 border-blue-400' : 'bg-white border-gray-200 hover:border-blue-300'}`}>
                            <div className="font-semibold text-gray-800">{d.name}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                                {d.question_count} questions · created {new Date(d.created_at).toLocaleString()}
                            </div>
                            {Array.isArray(d.section_stats) && (
                                <div className="flex gap-2 mt-2 text-xs text-gray-600">
                                    {d.section_stats.map(s => (
                                        <span key={s.code} className="bg-gray-100 px-2 py-0.5 rounded">
                                            {s.code} {s.drawn || 0}/{s.target} (L2:{s.difficulty?.L2 || 0}/L3:{s.difficulty?.L3 || 0})
                                        </span>
                                    ))}
                                </div>
                            )}
                            {Array.isArray(d.notes) && d.notes.length > 0 && (
                                <div className="mt-1 text-[11px] text-amber-700">⚠ {d.notes.length} note(s)</div>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* config modal */}
            {showConfig && (
                <ConfigModal
                    config={config}
                    setConfig={setConfig}
                    mockName={mockName}
                    setMockName={setMockName}
                    onClose={() => setShowConfig(false)}
                    onGenerate={generate}
                    generating={generating}
                />
            )}

            {/* selected mock review */}
            {selectedId && <MockReview key={selectedId} mockTestId={selectedId} onChanged={fetchDrafts} />}
        </div>
    );
}

function ConfigModal({ config, setConfig, mockName, setMockName, onClose, onGenerate, generating }) {
    const upd = (k, v) => setConfig(prev => ({ ...prev, [k]: v }));
    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6">
                <h2 className="text-lg font-bold mb-1">New CGL Tier 1 mock</h2>
                <p className="text-xs text-gray-500 mb-4">SSC CGL Tier 1 — 4 sections × 25 = 100 questions. Difficulty 2 & 3 only.</p>

                <label className="block mb-3">
                    <span className="text-xs font-semibold text-gray-600 uppercase">Mock name (optional)</span>
                    <input type="text" value={mockName} onChange={e => setMockName(e.target.value)}
                        placeholder="e.g. CGL T1 Mock 1"
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mt-1" />
                </label>

                <div className="space-y-2 mt-2">
                    <CheckRow label="Include English RC set (5 Q)"
                        checked={config.include_english_rc} onChange={v => upd('include_english_rc', v)} />
                    <CheckRow label="Include English Cloze set (5 Q)"
                        checked={config.include_english_cloze} onChange={v => upd('include_english_cloze', v)} />
                    <CheckRow label="Include Quant DI set (~3 Q)"
                        checked={config.include_quant_di} onChange={v => upd('include_quant_di', v)} />
                </div>

                <div className="grid grid-cols-2 gap-3 mt-4">
                    <NumberRow label="REASONING image placeholders"
                        value={config.reasoning_img_placeholder_count}
                        onChange={v => upd('reasoning_img_placeholder_count', v)} max={10} />
                    <NumberRow label="GA current-affairs placeholders"
                        value={config.ga_ca_placeholder_count}
                        onChange={v => upd('ga_ca_placeholder_count', v)} max={10} />
                </div>

                <div className="flex justify-end gap-2 mt-6">
                    <button onClick={onClose} disabled={generating}
                        className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
                    <button onClick={onGenerate} disabled={generating}
                        className="px-4 py-2 text-sm bg-green-600 text-white font-bold rounded-md hover:bg-green-700 disabled:opacity-50">
                        {generating ? 'Generating…' : 'Generate mock'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function CheckRow({ label, checked, onChange }) {
    return (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded" />
            <span>{label}</span>
        </label>
    );
}
function NumberRow({ label, value, onChange, max = 10 }) {
    return (
        <label className="block">
            <span className="text-xs font-semibold text-gray-600 uppercase">{label}</span>
            <input type="number" min={0} max={max} value={value}
                onChange={e => onChange(Math.max(0, Math.min(max, parseInt(e.target.value || '0', 10))))}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mt-1" />
        </label>
    );
}

// ---------- Mock review ----------

function MockReview({ mockTestId, onChanged }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [swappingId, setSwappingId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}`);
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Failed to load');
            setData(j);
        } catch (e) { setErr(e.message); }
        finally { setLoading(false); }
    }, [mockTestId]);
    useEffect(() => { load(); }, [load]);

    const swap = async (question_id) => {
        setSwappingId(question_id);
        setErr('');
        try {
            const res = await fetch(`/api/cgl-mock/${mockTestId}/swap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question_id }),
            });
            const j = await res.json();
            if (!res.ok || !j.success) throw new Error(j.error || 'Swap failed');
            await load();
            onChanged?.();
        } catch (e) { setErr(e.message); }
        finally { setSwappingId(null); }
    };

    const publish = async () => {
        if (!confirm('Publish this mock? It will become a permanent record.')) return;
        try {
            const res = await fetch(`/api/mock-test/${mockTestId}/publish`, { method: 'POST' });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Publish failed');
            await load();
            onChanged?.();
        } catch (e) { setErr(e.message); }
    };

    if (loading) return <div className="p-6 text-gray-400">Loading mock…</div>;
    if (err) return <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{err}</div>;
    if (!data) return null;

    const mock = data.mock;
    const stats = mock.stats || {};
    const notes = Array.isArray(stats.notes) ? stats.notes : [];

    return (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
                <div>
                    <div className="font-bold text-gray-800">{mock.name}</div>
                    <div className="text-xs text-gray-500">
                        Status: <span className="font-semibold">{mock.status}</span> · created {new Date(mock.created_at).toLocaleString()}
                    </div>
                </div>
                <div className="flex gap-2">
                    {mock.status === 'DRAFT' && (
                        <button onClick={publish}
                            className="px-3 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded hover:bg-blue-700">
                            Publish
                        </button>
                    )}
                </div>
            </div>

            {/* Stats bar */}
            <div className="px-5 py-3 border-b bg-white flex flex-wrap gap-2 text-xs">
                {(stats.section_stats || []).map(s => (
                    <span key={s.code} className="bg-gray-100 px-2 py-1 rounded">
                        <span className="font-bold">{s.code}</span> {s.drawn || 0}/{s.target}
                        {s.placeholder_count > 0 && <span className="text-gray-500"> +{s.placeholder_count} ph</span>}
                        <span className="ml-1 text-gray-500">L2:{s.difficulty?.L2 || 0} L3:{s.difficulty?.L3 || 0}</span>
                        {s.short > 0 && <span className="ml-1 text-amber-700">short {s.short}</span>}
                    </span>
                ))}
            </div>

            {notes.length > 0 && (
                <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
                    <div className="font-bold mb-0.5">Generation notes</div>
                    <ul className="list-disc pl-5">
                        {notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                </div>
            )}

            {/* Sections */}
            <div className="divide-y divide-gray-200">
                {data.sections.map(sec => (
                    <SectionView key={sec.code} section={sec} onSwap={swap} swappingId={swappingId} />
                ))}
            </div>
        </div>
    );
}

function SectionView({ section, onSwap, swappingId }) {
    const [open, setOpen] = useState(true);
    return (
        <div>
            <button onClick={() => setOpen(o => !o)}
                className="w-full px-5 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between text-left">
                <div className="text-sm font-bold text-gray-800">
                    {open ? '▾' : '▸'} {SECTION_LABELS[section.code] || section.code}
                    <span className="ml-2 text-gray-500 font-normal">({section.items.length} items)</span>
                </div>
            </button>
            {open && (
                <div className="px-5 py-3 space-y-2">
                    {section.items.map((it, idx) => (
                        <QuestionRow key={`${it.kind}-${idx}-${it.question_id || it.placeholder_id}`}
                            item={it} onSwap={onSwap} swappingId={swappingId} />
                    ))}
                </div>
            )}
        </div>
    );
}

function QuestionRow({ item, onSwap, swappingId }) {
    const [expanded, setExpanded] = useState(false);
    if (item.kind === 'placeholder') {
        return (
            <div className="border border-dashed border-amber-300 bg-amber-50 rounded p-3 flex items-center gap-3 text-sm">
                <span className="text-xs font-bold text-amber-700">#{item.position}</span>
                <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-900 text-xs font-mono">{item.placeholder_id}</span>
                <span className="text-amber-700 text-xs">placeholder — add manually after publish</span>
            </div>
        );
    }
    const isSwapping = swappingId === item.question_id;
    const opts = item.options || {};
    return (
        <div className="border border-gray-200 rounded p-3 text-sm bg-white">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs font-bold text-gray-500">#{item.position}</span>
                {item.group_id && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                        {item.stimulus?.group_type || 'GROUP'}
                    </span>
                )}
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono">{item.subtype || '?'}</span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded font-bold
                    ${item.difficulty === 2 ? 'bg-green-100 text-green-700' : item.difficulty === 3 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                    L{item.difficulty}
                </span>
                <span className="text-[11px] text-gray-500">answer: <span className="font-bold">{item.correct_option_label}</span></span>
                <button onClick={() => setExpanded(x => !x)}
                    className="ml-auto text-xs text-blue-600 hover:underline">{expanded ? 'Hide' : 'Show'}</button>
                <button onClick={() => onSwap(item.question_id)} disabled={isSwapping}
                    className="text-xs font-semibold px-2 py-1 rounded border border-red-300 text-red-700 bg-white hover:bg-red-50 disabled:opacity-50">
                    {isSwapping ? '…' : (item.group_id ? 'Swap group' : 'Delete & swap')}
                </button>
            </div>
            {expanded && (
                <div className="mt-2 space-y-2">
                    {item.stimulus?.passage_body?.text && (
                        <div className="p-3 bg-purple-50 border border-purple-200 rounded">
                            <div className="text-[10px] font-bold text-purple-700 uppercase mb-1">Passage / Stimulus</div>
                            <Latex>{item.stimulus.passage_body.text}</Latex>
                        </div>
                    )}
                    <div className="p-3 bg-gray-50 border border-gray-100 rounded">
                        <Latex>{item.body_json?.text || ''}</Latex>
                    </div>
                    <div className="space-y-1.5">
                        {['A', 'B', 'C', 'D'].map(k => (
                            <div key={k} className={`flex gap-2 p-2 rounded border text-sm
                                ${item.correct_option_label === k ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'}`}>
                                <span className="font-bold text-gray-700">{k}.</span>
                                <Latex>{opts[k]?.text || ''}</Latex>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
