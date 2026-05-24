'use client';

import { useState } from 'react';

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

export default function AdminMaintenance() {
    return (
        <div className="max-w-3xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">DB Maintenance</h1>
            <p className="text-sm text-gray-500 mb-8">One-off admin tasks to manually correct database state. Each task shows its result inline.</p>

            <div className="flex flex-col gap-4">
                {TASKS.map(task => (
                    <TaskCard key={task.id} task={task} />
                ))}
            </div>
        </div>
    );
}
