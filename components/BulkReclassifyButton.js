'use client';

import { useState } from 'react';

export default function BulkReclassifyButton() {
    const [isProcessing, setIsProcessing] = useState(false);

    const handleBulkReclassify = async () => {
        if (!confirm('This will reclassify ALL papers with sections containing more than 30 questions. This may take several minutes. Continue?')) {
            return;
        }

        setIsProcessing(true);
        try {
            const res = await fetch('/api/paper/bulk-reclassify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await res.json();
            if (data.success) {
                const summary = data.details
                    .map(d => `${d.paper} - ${d.section}: ${d.updated}/${d.originalCount} reclassified`)
                    .join('\n');

                let message = `✅ Bulk Reclassification Complete!\n\n` +
                    `Sections processed: ${data.totalSections}\n` +
                    `Questions updated: ${data.totalQuestionsUpdated}\n\n`;

                if (data.remainingPapers > 0) {
                    message += `⚠️ ${data.remainingPapers} more papers still need reclassification.\n\n` +
                        `Click "Bulk Reclassify" again to process the next batch.\n\n`;
                }

                message += `Details:\n${summary}`;

                alert(message);

                window.location.reload();
            } else {
                alert('❌ Error: ' + (data.error || 'Unknown error occurred'));
            }
        } catch (error) {
            console.error('Bulk reclassify error:', error);
            alert(`❌ Failed to complete bulk reclassification\n\nError: ${error.message}\n\nThis might be due to:\n- Network timeout (too many papers to process)\n- Server error\n\nTry processing fewer papers or contact support.`);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <button
            onClick={handleBulkReclassify}
            disabled={isProcessing}
            className="px-4 py-2 bg-amber-600 text-white text-sm font-bold rounded-md hover:bg-amber-700 transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Reclassify all papers with oversized sections (>30 questions)"
        >
            {isProcessing ? (
                <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Processing...</span>
                </>
            ) : (
                <>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    <span>Bulk Reclassify</span>
                </>
            )}
        </button>
    );
}
