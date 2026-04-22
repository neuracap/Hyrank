'use client';

import { useState, useEffect } from 'react';

// ─── Blueprint list sidebar ───────────────────────────────────────────────────
function BlueprintList({ blueprints, selectedId, onSelect, onNew }) {
    return (
        <div className="flex flex-col h-full">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-gray-900">Blueprints</h2>
                <button onClick={onNew}
                    className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700">
                    + New
                </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                {blueprints.length === 0 && (
                    <p className="text-xs text-gray-400 px-4 py-6 text-center">No blueprints yet</p>
                )}
                {blueprints.map(bp => (
                    <button key={bp.blueprint_id}
                        onClick={() => onSelect(bp)}
                        className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${selectedId === bp.blueprint_id ? 'bg-indigo-50 border-l-2 border-indigo-500' : ''}`}>
                        <div className="text-sm font-medium text-gray-900 truncate">{bp.name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{bp.exam_name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                            {(bp.config_json?.sections || []).map(s =>
                                `${s.code}:${s.total || (s.topic_slots || []).reduce((a, t) => a + (t.count || 0), 0)}`
                            ).join(' · ')}
                        </div>
                        {!bp.is_active && <span className="text-[10px] text-red-500 font-semibold">INACTIVE</span>}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ─── Slot row inside a section card ──────────────────────────────────────────
function SlotRow({ slot, listId, onChange, onRemove }) {
    return (
        <div className="flex items-center gap-2 py-1.5">
            <input
                type="text"
                list={listId}
                value={slot.subtype}
                onChange={e => onChange({ ...slot, subtype: e.target.value })}
                placeholder="Subtype..."
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <input
                type="number"
                min={1} max={50}
                value={slot.count}
                onChange={e => onChange({ ...slot, count: parseInt(e.target.value) || 1 })}
                className="w-14 text-sm border border-gray-200 rounded px-2 py-1 text-center focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <select
                value={slot.difficulty || ''}
                onChange={e => onChange({ ...slot, difficulty: e.target.value ? parseInt(e.target.value) : null })}
                className="text-xs border border-gray-200 rounded px-1 py-1 focus:outline-none">
                <option value="">Any</option>
                <option value="1">Easy</option>
                <option value="2">Medium</option>
                <option value="3">Hard</option>
            </select>
            <button onClick={onRemove} className="text-red-400 hover:text-red-600 text-xs px-1.5">✕</button>
        </div>
    );
}

// ─── Section card with its slots ─────────────────────────────────────────────
function SectionCard({ section, slots, onChange }) {
    const [subtypeOptions, setSubtypeOptions] = useState([]);

    // Fetch subtypes specific to this section on mount
    useEffect(() => {
        fetch(`/api/mock-blueprint/subtypes?section_id=${section.section_id}`)
            .then(r => r.json())
            .then(d => setSubtypeOptions(d.subtypes || []))
            .catch(() => {});
    }, [section.section_id]);

    const listId = `subtypes-${section.section_id}`;
    const total  = slots.reduce((a, s) => a + (s.count || 0), 0);
    const target = section.num_questions || 0;

    const addSlot    = () => onChange([...slots, { subtype: '', count: 5, difficulty: null }]);
    const updateSlot = (i, updated) => onChange(slots.map((s, j) => j === i ? updated : s));
    const removeSlot = (i) => onChange(slots.filter((_, j) => j !== i));

    return (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between">
                <div>
                    <span className="text-sm font-bold text-gray-800">{section.code}</span>
                    <span className="text-xs text-gray-500 ml-2">{section.name}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        total === target && target > 0 ? 'bg-green-100 text-green-700' :
                        total > target && target > 0  ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                    }`}>
                        {total}{target > 0 ? `/${target}` : ''} Qs
                    </span>
                    <button onClick={addSlot}
                        className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200">
                        + Slot
                    </button>
                </div>
            </div>
            {/* Per-section datalist so autocomplete is scoped correctly */}
            <datalist id={listId}>
                {subtypeOptions.map(s => <option key={s.subtype} value={s.subtype}>{s.subtype} ({s.cnt})</option>)}
            </datalist>
            <div className="px-4 py-2">
                {slots.length === 0 && (
                    <p className="text-xs text-gray-400 py-2 text-center">No slots yet — click + Slot to add</p>
                )}
                {slots.map((slot, i) => (
                    <SlotRow key={i} slot={slot} listId={listId}
                        onChange={u => updateSlot(i, u)}
                        onRemove={() => removeSlot(i)} />
                ))}
            </div>
        </div>
    );
}

// ─── Blueprint editor (right panel) ─────────────────────────────────────────
function BlueprintEditorPanel({ exams, blueprint, onSaved, onNew }) {
    const [name, setName]       = useState('');
    const [examId, setExamId]   = useState('');
    const [sections, setSections] = useState([]); // exam sections
    const [slotsBySection, setSlotsBySection] = useState({}); // section_id → slots[]
    const [saving, setSaving]   = useState(false);
    const [msg, setMsg]         = useState(null);

    const isNew = !blueprint?.blueprint_id;

    // When blueprint changes, populate editor
    useEffect(() => {
        if (!blueprint) {
            setName('');
            setExamId(exams[0]?.exam_id || '');
            setSlotsBySection({});
            return;
        }
        setName(blueprint.name || '');
        const eid = blueprint.exam_id || exams[0]?.exam_id || '';
        setExamId(eid);
        // Populate slots from config_json
        const cfg = blueprint.config_json || {};
        const newSlots = {};
        for (const sec of cfg.sections || []) {
            newSlots[sec.section_id] = (sec.topic_slots || []).map(t => ({
                subtype:    t.subtype    || '',
                count:      t.count      || 1,
                difficulty: t.difficulty || null,
            }));
        }
        setSlotsBySection(newSlots);
    }, [blueprint]);

    // When exam changes, load its sections
    useEffect(() => {
        if (!examId) return;
        const exam = exams.find(e => e.exam_id === examId);
        setSections(exam?.sections || []);
    }, [examId, exams]);

    const handleSave = async () => {
        if (!name.trim() || !examId) {
            setMsg({ type: 'error', text: 'Name and exam are required' });
            return;
        }
        setSaving(true);
        setMsg(null);
        try {
            // Build config_json from sections + slots
            const configSections = sections.map(s => ({
                section_id:  s.section_id,
                code:        s.code,
                name:        s.name,
                total:       (slotsBySection[s.section_id] || []).reduce((a, t) => a + (t.count || 0), 0),
                topic_slots: (slotsBySection[s.section_id] || []).filter(t => t.subtype),
            }));

            const res = await fetch('/api/mock-test/blueprint/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    blueprint_id: blueprint?.blueprint_id || undefined,
                    exam_id:      examId,
                    name:         name.trim(),
                    config_json:  { sections: configSections },
                }),
            });
            const data = await res.json();
            if (!res.ok) { setMsg({ type: 'error', text: data.error || 'Save failed' }); return; }
            setMsg({ type: 'success', text: 'Blueprint saved!' });
            onSaved(data.blueprint_id, name.trim(), examId, { sections: configSections });
        } catch (e) {
            setMsg({ type: 'error', text: e.message });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-white">
                <h2 className="text-sm font-bold text-gray-900">
                    {isNew ? 'New Blueprint' : 'Edit Blueprint'}
                </h2>
                {!isNew && (
                    <button onClick={onNew} className="text-xs text-indigo-600 hover:underline">+ New Blueprint</button>
                )}
            </div>

            {/* Name + exam */}
            <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3 bg-gray-50">
                <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Blueprint name..."
                    className="flex-1 text-sm border border-gray-200 rounded px-3 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 min-w-36"
                />
                <select value={examId} onChange={e => setExamId(e.target.value)}
                    disabled={!isNew}
                    className="text-sm border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none disabled:opacity-60">
                    {exams.map(e => <option key={e.exam_id} value={e.exam_id}>{e.name}</option>)}
                </select>
                <button onClick={handleSave} disabled={saving}
                    className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-semibold rounded hover:bg-indigo-700 disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save Blueprint'}
                </button>
                {msg && (
                    <span className={`text-xs px-2 py-1 rounded ${msg.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {msg.text}
                    </span>
                )}
            </div>

            {/* Section cards */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {sections.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-12">Select an exam to see its sections</p>
                )}
                {sections.map(s => (
                    <SectionCard
                        key={s.section_id}
                        section={s}
                        slots={slotsBySection[s.section_id] || []}
                        onChange={updated => setSlotsBySection(prev => ({ ...prev, [s.section_id]: updated }))}
                    />
                ))}
            </div>
        </div>
    );
}

// ─── PYQ Generator panel ─────────────────────────────────────────────────────
function PYQGenerator({ exams, onGenerated }) {
    const [examId, setExamId]         = useState(exams[0]?.exam_id || '');
    const [availableYears, setAvailableYears] = useState([]);
    const [selectedYears, setSelectedYears]   = useState([]);
    const [bpName, setBpName]         = useState('');
    const [generating, setGenerating] = useState(false);
    const [msg, setMsg]               = useState(null);
    const [preview, setPreview]       = useState(null);

    // Load available years when exam changes
    useEffect(() => {
        if (!examId) return;
        setAvailableYears([]);
        setSelectedYears([]);
        setPreview(null);
        fetch(`/api/mock-blueprint/available-years?exam_id=${examId}`)
            .then(r => r.json())
            .then(d => {
                const yrs = d.years || [];
                setAvailableYears(yrs);
                // Default: select the 4 most recent years
                setSelectedYears(yrs.slice(0, 4).map(y => y.year));
            })
            .catch(() => {});
    }, [examId]);

    const toggleYear = (yr) => {
        setSelectedYears(prev =>
            prev.includes(yr) ? prev.filter(y => y !== yr) : [...prev, yr].sort((a, b) => b - a)
        );
    };

    const handleGenerate = async () => {
        if (!selectedYears.length) { setMsg({ type: 'error', text: 'Select at least one year' }); return; }
        setGenerating(true);
        setMsg(null);
        setPreview(null);
        try {
            const res = await fetch('/api/mock-blueprint/generate-pyq', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    exam_id: examId,
                    name:    bpName.trim() || undefined,
                    years:   selectedYears,
                }),
            });
            const data = await res.json();
            if (!res.ok) { setMsg({ type: 'error', text: data.error || 'Generation failed' }); return; }
            setMsg({ type: 'success', text: `Blueprint "${data.name}" created!` });
            setPreview(data);
            onGenerated(data);
        } catch (e) {
            setMsg({ type: 'error', text: e.message });
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="px-5 py-3 border-b border-gray-100 bg-white">
                <h2 className="text-sm font-bold text-gray-900">Generate PYQ Blueprint</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                    Analyses the exam&apos;s own papers for selected years and creates a blueprint
                    with subtype slots matching the average distribution across those years.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                {/* Exam selector */}
                <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Exam</label>
                    <select value={examId} onChange={e => setExamId(e.target.value)}
                        className="text-sm border border-gray-200 rounded px-3 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400">
                        {exams.map(e => <option key={e.exam_id} value={e.exam_id}>{e.name}</option>)}
                    </select>
                </div>

                {/* Year selector */}
                {availableYears.length > 0 && (
                    <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">
                            Select Years <span className="text-gray-400 font-normal">(each year contributes equally)</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {availableYears.map(({ year, paper_count, question_count }) => (
                                <button key={year}
                                    onClick={() => toggleYear(year)}
                                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                                        selectedYears.includes(year)
                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                            : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
                                    }`}>
                                    {year}
                                    <span className={`ml-1.5 text-[10px] ${selectedYears.includes(year) ? 'text-indigo-200' : 'text-gray-400'}`}>
                                        {paper_count}p · {question_count}q
                                    </span>
                                </button>
                            ))}
                        </div>
                        {selectedYears.length > 0 && (
                            <p className="text-xs text-gray-400 mt-1.5">
                                {selectedYears.sort((a,b)=>b-a).join(', ')} selected — {selectedYears.length} year{selectedYears.length > 1 ? 's' : ''}
                            </p>
                        )}
                    </div>
                )}
                {availableYears.length === 0 && examId && (
                    <p className="text-xs text-gray-400">No papers with approved questions found for this exam.</p>
                )}

                {/* Optional name */}
                <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                        Blueprint Name <span className="font-normal text-gray-400">(optional — auto-generated if blank)</span>
                    </label>
                    <input type="text" value={bpName} onChange={e => setBpName(e.target.value)}
                        placeholder={`e.g. SSC CGL PYQ ${Math.min(...(selectedYears.length ? selectedYears : [2022]))}-${Math.max(...(selectedYears.length ? selectedYears : [2025]))}`}
                        className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                </div>

                <button onClick={handleGenerate} disabled={generating || !selectedYears.length}
                    className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    {generating ? 'Generating...' : 'Generate Blueprint'}
                </button>

                {msg && (
                    <div className={`text-sm px-3 py-2 rounded ${msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {msg.text}
                    </div>
                )}

                {/* Preview of generated sections */}
                {preview && (
                    <div className="space-y-3">
                        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Generated Slots</h3>
                        {(preview.config_json?.sections || []).map(sec => (
                            <div key={sec.section_id} className="border border-gray-200 rounded-lg overflow-hidden">
                                <div className="bg-gray-50 px-3 py-2 flex items-center justify-between">
                                    <span className="text-sm font-bold text-gray-800">{sec.code}</span>
                                    <span className="text-xs text-indigo-600 font-semibold">{sec.total} Qs</span>
                                </div>
                                <div className="px-3 py-2 flex flex-wrap gap-1.5">
                                    {(sec.topic_slots || []).map((slot, i) => (
                                        <span key={i} className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded">
                                            {slot.subtype} ×{slot.count}
                                        </span>
                                    ))}
                                    {(sec.topic_slots || []).length === 0 && (
                                        <span className="text-xs text-gray-400">No subtype data</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function MockBlueprintEditor({ exams, initialBlueprints }) {
    const [blueprints, setBlueprints] = useState(initialBlueprints || []);
    const [selected, setSelected]     = useState(null);
    const [tab, setTab]               = useState('edit'); // 'edit' | 'pyq'

    const handleSaved = (bpId, bpName, examId, configJson) => {
        const exam = exams.find(e => e.exam_id === examId);
        setBlueprints(prev => {
            const existing = prev.find(b => b.blueprint_id === bpId);
            if (existing) {
                return prev.map(b => b.blueprint_id === bpId
                    ? { ...b, name: bpName, config_json: configJson }
                    : b
                );
            }
            return [{ blueprint_id: bpId, name: bpName, exam_id: examId, exam_name: exam?.name, config_json: configJson, is_active: true }, ...prev];
        });
        setSelected(b => b ? { ...b, blueprint_id: bpId, name: bpName, config_json: configJson } : null);
    };

    const handleGenerated = (data) => {
        // Add the newly created PYQ blueprint to the list and open it for editing
        const exam = exams.find(e => e.exam_id === data.config_json?.generated_from?.exam_id);
        setBlueprints(prev => [{
            blueprint_id: data.blueprint_id,
            name:         data.name,
            exam_id:      exams[0]?.exam_id, // will be overwritten when opened
            exam_name:    exam?.name || '',
            config_json:  data.config_json,
            is_active:    true,
        }, ...prev]);
        // Switch to edit tab with the new blueprint pre-loaded
        setTab('edit');
        setSelected({ blueprint_id: data.blueprint_id, name: data.name, config_json: data.config_json });
    };

    return (
        <div className="flex h-screen bg-gray-50">
            {/* Left: list */}
            <div className="w-64 border-r border-gray-200 bg-white flex flex-col shrink-0">
                <BlueprintList
                    blueprints={blueprints}
                    selectedId={selected?.blueprint_id}
                    onSelect={bp => { setSelected(bp); setTab('edit'); }}
                    onNew={() => { setSelected(null); setTab('edit'); }}
                />
            </div>

            {/* Right: tabs */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Tab bar */}
                <div className="flex border-b border-gray-200 bg-white shrink-0">
                    {[
                        { id: 'edit', label: 'Manual Editor' },
                        { id: 'pyq',  label: 'Generate from PYQ' },
                    ].map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                tab === t.id
                                    ? 'border-indigo-500 text-indigo-700'
                                    : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}>
                            {t.label}
                        </button>
                    ))}
                </div>

                <div className="flex-1 overflow-hidden">
                    {tab === 'edit' ? (
                        <BlueprintEditorPanel
                            exams={exams}
                            blueprint={selected}
                            onSaved={handleSaved}
                            onNew={() => setSelected(null)}
                        />
                    ) : (
                        <PYQGenerator exams={exams} onGenerated={handleGenerated} />
                    )}
                </div>
            </div>
        </div>
    );
}
