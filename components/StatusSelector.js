'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function StatusSelector({ paperSessionId, currentStatus }) {
    const router = useRouter();
    const [status, setStatus] = useState(currentStatus || 'NOT_REVIEWED');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const statusMap = {
        'NOT_REVIEWED': { label: 'Not Reviewed', color: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400' },
        'TEAM_REVIEWED': { label: 'Team Reviewed', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
        'MISSING_ADDED': { label: 'Missing Added', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
        'PRE_PUBLISH_READY': { label: 'Pre-Publish Ready', color: 'bg-teal-100 text-teal-700', dot: 'bg-teal-500' },
        'SOLUTION_REVIEW': { label: 'Solution Review', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
        'PRODUCTION': { label: 'Production', color: 'bg-green-100 text-green-800', dot: 'bg-green-500' }
    };

    const handleStatusChange = async (e) => {
        const newStatus = e.target.value;
        if (newStatus === status) return;

        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/paper/advance-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paper_session_id: paperSessionId,
                    next_status: newStatus
                })
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Failed to update status');
                // Revert to old value visually
                e.target.value = status;
            } else {
                setStatus(newStatus);
                router.refresh();
            }
        } catch (err) {
            setError('An error occurred. Please try again.');
            e.target.value = status;
        } finally {
            setLoading(false);
        }
    };

    const config = statusMap[status] || { label: status, color: 'bg-gray-100 text-gray-800', dot: 'bg-gray-500' };

    return (
        <div className="flex flex-col gap-1">
            <div className={`relative flex items-center rounded-md border border-transparent hover:border-gray-200 transition-colors ${config.color} px-2 py-1`}>
                <div className={`w-2 h-2 rounded-full absolute left-3 pointer-events-none ${config.dot}`}></div>
                <select
                    value={status}
                    onChange={handleStatusChange}
                    disabled={loading}
                    className="appearance-none bg-transparent hover:bg-white/50 border-none font-medium text-sm pl-4 pr-6 py-0.5 rounded cursor-pointer w-full focus:ring-0"
                >
                    {Object.entries(statusMap).map(([key, val]) => (
                        <option key={key} value={key} className="text-gray-900 bg-white">
                            {val.label}
                        </option>
                    ))}
                </select>
                <div className="pointer-events-none absolute right-2 text-current opacity-70 text-xs">▼</div>
            </div>
            {error && (
                <div className="text-xs text-red-600 font-medium px-1 max-w-[150px] leading-tight break-words">
                    {error}
                </div>
            )}
            {loading && (
                <div className="text-xs text-blue-600 font-medium px-1">
                    Updating...
                </div>
            )}
        </div>
    );
}
