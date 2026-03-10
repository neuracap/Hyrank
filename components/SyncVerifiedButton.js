'use client';

import { useState } from 'react';

export default function SyncVerifiedButton() {
    const [isProcessing, setIsProcessing] = useState(false);
    const [result, setResult] = useState(null);

    const handleSync = async () => {
        setIsProcessing(true);
        setResult(null);
        try {
            const res = await fetch('/api/paper/sync-verified', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (data.success) {
                setResult(`${data.updated} question(s) marked verified`);
            } else {
                console.error('Sync verified error:', data.error);
                setResult('Error — check console');
            }
        } catch (error) {
            console.error('Sync verified error:', error.message);
            setResult('Error — check console');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex flex-col items-end gap-1">
            <button
                onClick={handleSync}
                disabled={isProcessing}
                className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-md hover:bg-emerald-700 transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Copy MANUALLY_CORRECTED status from question_links → is_verified on question_version"
            >
                {isProcessing ? (
                    <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Syncing...</span>
                    </>
                ) : (
                    <>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                        <span>Sync Verified</span>
                    </>
                )}
            </button>
            {result && (
                <span className="text-xs text-emerald-700 font-medium">{result}</span>
            )}
        </div>
    );
}
