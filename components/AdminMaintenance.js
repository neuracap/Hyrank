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

function validateRcPayload(parsed) {
    const errors = [];
    if (!parsed || typeof parsed !== 'object') {
        errors.push('Root must be an object.');
        return { errors, passageCount: 0, questionCount: 0, difficultyCounts: {} };
    }
    if (!Array.isArray(parsed.passages) || parsed.passages.length === 0) {
        errors.push('"passages" must be a non-empty array.');
        return { errors, passageCount: 0, questionCount: 0, difficultyCounts: {} };
    }
    let questionCount = 0;
    const difficultyCounts = {};
    // RC convention: easy/medium/hard -> 2/3/4. Difficulty 1 is reserved
    // for very-easy GD/newbie questions (must be passed explicitly as 1).
    const diffMap = { easy: 2, e: 2, medium: 3, m: 3, hard: 4, h: 4, very_hard: 4, 'very hard': 4, vh: 4 };
    parsed.passages.forEach((p, idx) => {
        if (!p || typeof p !== 'object') { errors.push(`passages[${idx}]: not an object.`); return; }
        if (!p.passage_text || !String(p.passage_text).trim()) errors.push(`passages[${idx}]: passage_text missing.`);
        if (!Array.isArray(p.questions) || p.questions.length === 0) {
            errors.push(`passages[${idx}]: questions empty.`);
            return;
        }
        p.questions.forEach((q, qi) => {
            questionCount++;
            const tag = `passages[${idx}].questions[${qi}]${q?.qid ? ` (${q.qid})` : ''}`;
            if (!q || typeof q !== 'object') { errors.push(`${tag}: not an object.`); return; }
            if (!q.stem || !String(q.stem).trim()) errors.push(`${tag}: stem missing.`);
            // options can be array or object
            let optsOk = false;
            if (Array.isArray(q.options) && q.options.length >= 4) optsOk = true;
            else if (q.options && typeof q.options === 'object') {
                optsOk = ['A', 'B', 'C', 'D'].every(k => q.options[k] || q.options[k.toLowerCase()]);
            }
            if (!optsOk) errors.push(`${tag}: options missing or fewer than 4.`);
            const ansMatch = q.answer && String(q.answer).match(/[A-Da-d]/);
            if (!ansMatch) errors.push(`${tag}: answer invalid.`);
            // difficulty
            const d = q.difficulty;
            let dn = null;
            if (typeof d === 'number') dn = [1, 2, 3, 4].includes(d) ? d : null;
            else if (typeof d === 'string') dn = diffMap[d.trim().toLowerCase()] || ([1, 2, 3, 4].includes(parseInt(d, 10)) ? parseInt(d, 10) : null);
            if (!dn) errors.push(`${tag}: difficulty invalid (use easy|medium|hard or 1-4).`);
            else difficultyCounts[dn] = (difficultyCounts[dn] || 0) + 1;
        });
    });
    return { errors, passageCount: parsed.passages.length, questionCount, difficultyCounts };
}

function RcUploadCard() {
    const [raw, setRaw] = useState('');
    const [parsed, setParsed] = useState(null);
    const [parseError, setParseError] = useState(null);
    const [validation, setValidation] = useState(null);
    const [status, setStatus] = useState('idle');
    const [result, setResult] = useState(null);
    const [fileName, setFileName] = useState('');
    const [skipHindi, setSkipHindi] = useState(true);
    const [subtype, setSubtype] = useState('comprehension_rc');
    const [sourceTag, setSourceTag] = useState('');
    const [progress, setProgress] = useState({ done: 0, total: 0, current: null });

    function tryParse(text) {
        setRaw(text);
        setResult(null);
        setStatus('idle');
        setProgress({ done: 0, total: 0, current: null });
        if (!text.trim()) { setParsed(null); setParseError(null); setValidation(null); return; }
        try {
            const obj = JSON.parse(text);
            setParsed(obj);
            setParseError(null);
            setValidation(validateRcPayload(obj));
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
        const passageCount = validation.passageCount;
        const questionCount = validation.questionCount;
        if (!confirm(`Insert ${passageCount} passage${passageCount === 1 ? '' : 's'} with ${questionCount} total questions as APPROVED?${skipHindi ? '\n\n(Hindi translation OFF — HI rows will be empty; backfill later.)' : '\n\n(Hindi translation ON — may take 10-30 sec per passage.)'}\n\nProcessing one passage per request to avoid timeouts.`)) return;
        setStatus('running');
        setResult(null);

        // Process one passage per request — avoids Railway 60s function timeout
        // on multi-passage payloads.
        const baseSubtype = subtype || parsed.subtype || 'comprehension_rc';
        const baseSourceTag = sourceTag || parsed.source_tag || parsed?.meta?.title || null;
        const passages = parsed.passages || [];
        const totals = { inserted_count: 0, skipped_count: 0, member_count_total: 0, inserted: [], skipped: [] };

        setProgress({ done: 0, total: passages.length, current: null });

        try {
            for (let i = 0; i < passages.length; i++) {
                const p = passages[i];
                setProgress({ done: i, total: passages.length, current: p?.passage_id || `#${i}` });
                const body = {
                    ...parsed,
                    passages: [p],
                    subtype: baseSubtype,
                    skip_hindi: skipHindi,
                    source_tag: baseSourceTag,
                };
                const res = await fetch('/api/rc/bulk-approve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                let data;
                try {
                    data = await res.json();
                } catch {
                    // Non-JSON response (e.g. Railway "upstream error" 502).
                    const txt = await res.text().catch(() => '');
                    totals.skipped_count++;
                    totals.skipped.push({
                        index: i,
                        passage_id: p?.passage_id || null,
                        reason: `HTTP ${res.status}: ${txt.slice(0, 200) || 'no body'}`,
                    });
                    continue;
                }
                if (!res.ok) {
                    totals.skipped_count++;
                    totals.skipped.push({
                        index: i,
                        passage_id: p?.passage_id || null,
                        reason: data?.error || `HTTP ${res.status}`,
                    });
                    continue;
                }
                // Merge per-request results into running totals.
                totals.inserted_count += data.inserted_count || 0;
                totals.skipped_count += data.skipped_count || 0;
                totals.member_count_total += data.member_count_total || 0;
                if (Array.isArray(data.inserted)) {
                    for (const ins of data.inserted) totals.inserted.push({ ...ins, batch_index: i });
                }
                if (Array.isArray(data.skipped)) {
                    for (const s of data.skipped) totals.skipped.push({ ...s, batch_index: i });
                }
            }
            setProgress({ done: passages.length, total: passages.length, current: null });
            setStatus('done');
            setResult({ success: true, ...totals });
        } catch (e) {
            setStatus('error');
            setResult({ error: e.message, partial: totals });
        }
    }

    const errCount = validation?.errors?.length || 0;
    const canSubmit = !!parsed && errCount === 0 && status !== 'running';
    const diffLabel = (d) => ({ 1: 'very_easy', 2: 'easy', 3: 'medium', 4: 'hard' }[d] || `?(${d})`);

    return (
        <div className="border border-gray-200 rounded-lg p-5 bg-white">
            <div className="mb-3">
                <h3 className="font-semibold text-gray-900">Upload RC Passages (bulk-approve)</h3>
                <p className="text-sm text-gray-500 mt-1">
                    Upload a JSON file shaped like <span className="font-mono">rc_question_bank_*.json</span> — each
                    passage becomes a <span className="font-mono">question_group</span> (RC) with a PASSAGE row +
                    member MCQ rows + options. Inserts as <span className="font-mono">APPROVED</span> into the English
                    bank section. Answer accepts <span className="font-mono">"Option d"</span>, <span className="font-mono">"d"</span>, or <span className="font-mono">"D"</span>;
                    difficulty accepts <span className="font-mono">easy/medium/hard</span> or <span className="font-mono">1-4</span>.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <label className="text-sm">
                    <span className="block text-xs text-gray-500 mb-1">Subtype</span>
                    <input
                        value={subtype}
                        onChange={(e) => setSubtype(e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm font-mono"
                        placeholder="comprehension_rc"
                    />
                </label>
                <label className="text-sm">
                    <span className="block text-xs text-gray-500 mb-1">Source tag (optional, into meta)</span>
                    <input
                        value={sourceTag}
                        onChange={(e) => setSourceTag(e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
                        placeholder="e.g. Face2Face CAT, Passages 21-40"
                    />
                </label>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700 mb-3">
                <input
                    type="checkbox"
                    checked={skipHindi}
                    onChange={(e) => setSkipHindi(e.target.checked)}
                />
                Skip Hindi translation <span className="text-xs text-gray-500">(default ON for RC — HI rows get empty body; backfill later via /api/translate)</span>
            </label>

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
                placeholder='{"passages":[{"passage_text":"...","questions":[{"stem":"...","options":[{"label":"a","text":"..."},...],"answer":"Option a","difficulty":"medium"}]}]}'
                rows={6}
                className="w-full font-mono text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />

            {parseError && (
                <div className="mt-2 text-sm bg-red-50 text-red-800 rounded-md px-3 py-2">
                    JSON parse error: {parseError}
                </div>
            )}

            {validation && (
                <div className="mt-3 text-sm">
                    <div className="flex items-center gap-4 mb-2 flex-wrap">
                        <span className="text-gray-700">
                            <span className="font-semibold">{validation.passageCount}</span> passages,{' '}
                            <span className="font-semibold">{validation.questionCount}</span> total questions
                        </span>
                        {errCount > 0 ? (
                            <span className="text-red-700 font-medium">{errCount} validation error{errCount === 1 ? '' : 's'}</span>
                        ) : (
                            <span className="text-green-700 font-medium">✓ valid</span>
                        )}
                    </div>
                    {Object.keys(validation.difficultyCounts).length > 0 && (
                        <div className="text-xs text-gray-500 mb-2">
                            Difficulty: {Object.entries(validation.difficultyCounts)
                                .sort((a, b) => a[0] - b[0])
                                .map(([d, n]) => `${diffLabel(d)} (${n})`).join(', ')}
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

            <div className="mt-4 flex items-center justify-between gap-4">
                {status === 'running' && progress.total > 0 ? (
                    <div className="flex-1 flex items-center gap-3">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-indigo-500 transition-all"
                                style={{ width: `${(progress.done / progress.total) * 100}%` }}
                            />
                        </div>
                        <span className="text-xs text-gray-600 whitespace-nowrap">
                            {progress.done} / {progress.total}{progress.current ? ` (${progress.current})` : ''}
                        </span>
                    </div>
                ) : <div />}
                <button
                    onClick={submit}
                    disabled={!canSubmit}
                    className="px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                    {status === 'running' ? 'Uploading...' : `Insert as APPROVED${validation?.passageCount ? ` (${validation.passageCount}p / ${validation.questionCount}q)` : ''}`}
                </button>
            </div>

            {result && (
                <div className={`mt-3 text-sm rounded-md px-3 py-2 ${status === 'done' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                    {status === 'done' ? (
                        <div>
                            <div className="font-semibold mb-1">
                                Inserted: {result.inserted_count} passages ({result.member_count_total} questions) · Skipped: {result.skipped_count}
                            </div>
                            {result.skipped_count > 0 && (
                                <details className="mt-2">
                                    <summary className="cursor-pointer">Skipped passages</summary>
                                    <ul className="text-xs mt-1 font-mono list-disc list-inside max-h-40 overflow-auto">
                                        {result.skipped.map((s, i) => (
                                            <li key={i}>#{s.batch_index ?? s.index}{s.passage_id ? ` (${s.passage_id})` : ''}: {s.reason}</li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
                    ) : (
                        <div>
                            <div className="font-mono mb-1">{result.error}</div>
                            {result.partial && (result.partial.inserted_count > 0 || result.partial.skipped_count > 0) && (
                                <div className="text-xs">
                                    Partial: {result.partial.inserted_count} inserted, {result.partial.skipped_count} skipped before the error.
                                </div>
                            )}
                        </div>
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
                <RcUploadCard />
            </div>
        </div>
    );
}
