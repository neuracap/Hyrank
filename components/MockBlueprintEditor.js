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

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function MockBlueprintEditor({ exams, initialBlueprints }) {
    const [blueprints, setBlueprints] = useState(initialBlueprints || []);
    const [selected, setSelected]     = useState(null);

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
        // Update selected
        setSelected(b => b ? { ...b, blueprint_id: bpId, name: bpName, config_json: configJson } : null);
    };

    return (
        <div className="flex h-screen bg-gray-50">
            {/* Left: list */}
            <div className="w-64 border-r border-gray-200 bg-white flex flex-col shrink-0">
                <BlueprintList
                    blueprints={blueprints}
                    selectedId={selected?.blueprint_id}
                    onSelect={setSelected}
                    onNew={() => setSelected(null)}
                />
            </div>

            {/* Right: editor */}
            <div className="flex-1 overflow-hidden">
                <BlueprintEditorPanel
                    exams={exams}
                    blueprint={selected}
                    onSaved={handleSaved}
                    onNew={() => setSelected(null)}
                />
            </div>
        </div>
    );
}
