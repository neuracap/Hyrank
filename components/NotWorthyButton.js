'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NotWorthyButton({ paperSessionId }) {
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleClick = async () => {
        if (!confirm('Mark this paper as NOT PRODUCTION WORTHY? It will be excluded from all workflows.')) return;
        setLoading(true);
        try {
            const res = await fetch('/api/paper/advance-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paper_session_id: paperSessionId, next_status: 'NOT_WORTHY' }),
            });
            if (res.ok) {
                router.refresh();
            } else {
                const data = await res.json();
                alert(data.error || 'Failed');
            }
        } catch (e) {
            alert('Error: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            onClick={handleClick}
            disabled={loading}
            className="block w-full text-center px-3 py-1 bg-red-50 text-red-600 text-xs font-bold rounded border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
        >
            {loading ? '...' : 'Not Worthy'}
        </button>
    );
}
