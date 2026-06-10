'use client';

import { useState } from 'react';

const CA_SUBTYPES = [
    'ca_economy', 'ca_polity_schemes', 'ca_awards_sports',
    'ca_international', 'ca_science_tech', 'ca_misc',
];

const TASKS = [
    {
        id: 'recount-paper-stats',
        label: 'Recount paper_session stats',
        description: 'Recalculates total_question_count, manually_corrected_count, manually_corrected_no_image_count, ready_for_solution_count, and solution_done_count for all paper sessions from question_version.',
        endpoint: '/api/admin/maintenance/recount-paper-stats',
        confirmText: 'This will update count columns across all paper sessions. Continue?',
    },
    {
        id: 'promote-fully-corrected',
        label: 'Promote fully-corrected papers to TEAM_REVIEWED',
        description: 'Finds papers currently in NOT_REVIEWED where every question_version row has status MANUALLY_CORRECTED, and advances them to TEAM_REVIEWED. Counts are computed live and status_history is appended.',
        endpoint: '/api/admin/maintenance/promote-fully-corrected',
        confirmText: 'This will bump all eligible NOT_REVIEWED papers to TEAM_REVIEWED. Continue?',
    },
    // Add new tasks here
];

function TaskCard({ task }) {
    const [status, setStatus] = useState('idle'); // idle | running | done | error
    const [result, setResult] = useState(null);

    async function run() {
        if (!confirm(task.confirmText)) return;
        setStatus('running');
        setResult(null);
        try {
            const res = await fetch(task.endpoint, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Request failed');
            setStatus('done');
            setResult(data);
        } catch (e) {
            setStatus('error');
            setResult({ error: e.message });
        }
    }

    return (
        <div className="border border-gray-200 rounded-lg p-5 bg-white">
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{task.label}</h3>
                    <p className="text-sm text-gray-500 mt-1">{task.description}</p>
                </div>
                <button
                    onClick={run}
                    disabled={status === 'running'}
                    className="shrink-0 px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {status === 'running' ? 'Running...' : 'Run'}
                </button>
            </div>

            {result && (
                <div className={`mt-3 text-sm rounded-md px-3 py-2 font-mono ${status === 'done' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                    {JSON.stringify(result, null, 2)}
                </div>
            )}
        </div>
    );
}

function validateCaPayload(parsed) {
    const errors = [];
    if (!parsed || typeof parsed !== 'object') {
        errors.push('Root must be an object.');
        return { errors, itemCount: 0, subtypeCounts: {} };
    }
    if (!Number.isInteger(parsed.year) || parsed.year < 2000 || parsed.year > 2100) {
        errors.push('Top-level "year" must be a 4-digit integer.');
    }
    if (!Number.isInteger(parsed.quarter) || parsed.quarter < 1 || parsed.quarter > 4) {
        errors.push('Top-level "quarter" must be 1, 2, 3, or 4.');
    }
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
        errors.push('"items" must be a non-empty array.');
        return { errors, itemCount: 0, subtypeCounts: {} };
    }
    const subtypeCounts = {};
    parsed.items.forEach((it, idx) => {
        if (!it || typeof it !== 'object') {
            errors.push(`items[${idx}]: not an object.`);
            return;
        }
        if (!it.question || !String(it.question).trim()) errors.push(`items[${idx}]: missing question.`);
        const opts = it.options || {};
        for (const k of ['A', 'B', 'C', 'D']) {
            if (!opts[k] || !String(opts[k]).trim()) errors.push(`items[${idx}]: missing option ${k}.`);
        }
        if (!['A', 'B', 'C', 'D'].includes(String(it.answer || '').toUpperCase())) {
            errors.push(`items[${idx}]: answer must be A, B, C, or D.`);
        }
        if (!CA_SUBTYPES.includes(it.ca_subtype)) {
            errors.push(`items[${idx}]: ca_subtype must be one of ${CA_SUBTYPES.join(', ')}.`);
        } else {
            subtypeCounts[it.ca_subtype] = (subtypeCounts[it.ca_subtype] || 0) + 1;
        }
        if (it.difficulty != null && ![1, 2, 3, 4].includes(parseInt(it.difficulty, 10))) {
            errors.push(`items[${idx}]: difficulty must be 1, 2, 3, or 4.`);
        }
    });
    return { errors, itemCount: parsed.items.length, subtypeCounts };
}

function CurrentAffairsUploadCard() {
    const [raw, setRaw] = useState('');
    const [parsed, setParsed] = useState(null);
    const [parseError, setParseError] = useState(null);
    const [validation, setValidation] = useState(null);
    const [status, setStatus] = useState('idle'); // idle | running | done | error
    const [result, setResult] = useState(null);
    const [fileName, setFileName] = useState('');

    function tryParse(text) {
        setRaw(text);
        setResult(null);
        setStatus('idle');
        if (!text.trim()) {
            setParsed(null); setParseError(null); setValidation(null); return;
        }
        try {
            const obj = JSON.parse(text);
            setParsed(obj);
            setParseError(null);
            setValidation(validateCaPayload(obj));
        } catch (e) {
            setParsed(null);
            setParseError(e.message);
            setValidation(null);
        }
    }

    async function onFile(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        setFileName(file.name);
        const text = await file.text();
        tryParse(text);
    }

    async function submit() {
        if (!parsed || (validation?.errors?.length || 0) > 0) return;
        const itemCount = validation.itemCount;
        if (!confirm(`Insert ${itemCount} CA question${itemCount === 1 ? '' : 's'} directly as APPROVED into the bank?`)) return;
        setStatus('running');
        setResult(null);
        try {
            const res = await fetch('/api/current-affairs/bulk-approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(parsed),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Request failed');
            setStatus('done');
            setResult(data);
        } catch (e) {
            setStatus('error');
            setResult({ error: e.message });
        }
    }

    const errCount = validation?.errors?.length || 0;
    const canSubmit = !!parsed && errCount === 0 && status !== 'running';

    return (
        <div className="border border-gray-200 rounded-lg p-5 bg-white">
            <div className="mb-3">
                <h3 className="font-semibold text-gray-900">Upload Current Affairs (bulk-approve)</h3>
                <p className="text-sm text-gray-500 mt-1">
                    Upload a JSON file or paste JSON below. Each item is inserted directly as <span className="font-mono">APPROVED</span>:
                    creates <span className="font-mono">current_affairs</span> + <span className="font-mono">question</span> +{' '}
                    <span className="font-mono">question_version</span> EN/HI (auto-translated) + 8{' '}
                    <span className="font-mono">question_option</span> rows per item, in a per-item transaction.
                    Per-item required fields: <span className="font-mono">question</span>,{' '}
                    <span className="font-mono">options.A-D</span>, <span className="font-mono">answer</span>,{' '}
                    <span className="font-mono">ca_subtype</span>, <span className="font-mono">difficulty</span> (1-4, default 2).
                </p>
            </div>

            <div className="flex items-center gap-3 mb-3">
                <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-300 bg-gray-50 hover:bg-gray-100 cursor-pointer text-sm">
                    <input type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
                    Choose JSON file
                </label>
                {fileName && <span className="text-sm text-gray-500 truncate">{fileName}</span>}
                {raw && (
                    <button
                        onClick={() => { setRaw(''); setParsed(null); setParseError(null); setValidation(null); setFileName(''); setResult(null); setStatus('idle'); }}
                        className="text-xs text-gray-500 hover:text-gray-700 underline ml-auto"
                    >
                        clear
                    </button>
                )}
            </div>

            <textarea
                value={raw}
                onChange={(e) => tryParse(e.target.value)}
                placeholder='{"year":2026,"quarter":2,"items":[{"question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","ca_subtype":"ca_misc","difficulty":2}]}'
                rows={8}
                className="w-full font-mono text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />

            {parseError && (
                <div className="mt-2 text-sm bg-red-50 text-red-800 rounded-md px-3 py-2">
                    JSON parse error: {parseError}
                </div>
            )}

            {validation && (
                <div className="mt-3 text-sm">
                    <div className="flex items-center gap-4 mb-2">
                        <span className="text-gray-700">
                            <span className="font-semibold">{validation.itemCount}</span> items detected
                        </span>
                        {errCount > 0 ? (
                            <span className="text-red-700 font-medium">{errCount} validation error{errCount === 1 ? '' : 's'}</span>
                        ) : (
                            <span className="text-green-700 font-medium">✓ valid</span>
                        )}
                    </div>
                    {Object.keys(validation.subtypeCounts).length > 0 && (
                        <div className="text-xs text-gray-500 mb-2">
                            Subtypes: {Object.entries(validation.subtypeCounts).map(([k, v]) => `${k} (${v})`).join(', ')}
                        </div>
                    )}
                    {errCount > 0 && (
                        <ul className="text-xs text-red-700 bg-red-50 rounded-md px-3 py-2 max-h-40 overflow-auto list-disc list-inside">
                            {validation.errors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
                            {validation.errors.length > 50 && <li>… and {validation.errors.length - 50} more</li>}
                        </ul>
                    )}
                </div>
            )}

            <div className="mt-4 flex justify-end">
                <button
                    onClick={submit}
                    disabled={!canSubmit}
                    className="px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {status === 'running' ? 'Uploading...' : `Insert as APPROVED${validation?.itemCount ? ` (${validation.itemCount})` : ''}`}
                </button>
            </div>

            {result && (
                <div className={`mt-3 text-sm rounded-md px-3 py-2 ${status === 'done' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                    {status === 'done' ? (
                        <div>
                            <div className="font-semibold mb-1">
                                Inserted: {result.inserted_count} · Skipped: {result.skipped_count}
                            </div>
                            {result.skipped_count > 0 && (
                                <details className="mt-2">
                                    <summary className="cursor-pointer">Skipped items</summary>
                                    <ul className="text-xs mt-1 font-mono list-disc list-inside max-h-40 overflow-auto">
                                        {result.skipped.map((s, i) => (
                                            <li key={i}>#{s.index}{s.source_id ? ` (${s.source_id})` : ''}: {s.reason}</li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
                    ) : (
                        <div className="font-mono">{result.error}</div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function AdminMaintenance() {
    return (
        <div className="max-w-3xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">DB Maintenance</h1>
            <p className="text-sm text-gray-500 mb-8">One-off admin tasks to manually correct database state. Each task shows its result inline.</p>

            <div className="flex flex-col gap-4">
                {TASKS.map(task => (
                    <TaskCard key={task.id} task={task} />
                ))}
                <CurrentAffairsUploadCard />
            </div>
        </div>
    );
}
