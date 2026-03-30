'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';

export default function TestReviewFilters({ exams }) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const currentExam = searchParams.get('exam') || 'ALL';
    const currentQcount = searchParams.get('qcount') || 'ALL';
    const currentStatus = searchParams.get('status') || 'ALL';

    const [exam, setExam] = useState(currentExam);
    const [qcount, setQcount] = useState(currentQcount);
    const [status, setStatus] = useState(currentStatus);

    useEffect(() => {
        setExam(searchParams.get('exam') || 'ALL');
        setQcount(searchParams.get('qcount') || 'ALL');
        setStatus(searchParams.get('status') || 'ALL');
    }, [searchParams]);

    const handleFilterChange = (newExam, newQcount, newStatus) => {
        setExam(newExam);
        setQcount(newQcount);
        setStatus(newStatus);

        const params = new URLSearchParams();

        if (newExam !== 'ALL') params.set('exam', newExam);
        if (newQcount !== 'ALL') params.set('qcount', newQcount);
        if (newStatus !== 'ALL') params.set('status', newStatus);

        router.push(`/test-review?${params.toString()}`);
    };

    return (
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2">
                    <label htmlFor="exam-filter" className="text-sm font-semibold text-gray-700">Exam:</label>
                    <select
                        id="exam-filter"
                        value={exam}
                        onChange={(e) => handleFilterChange(e.target.value, qcount, status)}
                        className="text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 py-1.5 pl-3 pr-8"
                    >
                        <option value="ALL">All Exams</option>
                        {exams.map(e => (
                            <option key={e} value={e}>{e}</option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <label htmlFor="status-filter" className="text-sm font-semibold text-gray-700">Status:</label>
                    <select
                        id="status-filter"
                        value={status}
                        onChange={(e) => handleFilterChange(exam, qcount, e.target.value)}
                        className="text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 py-1.5 pl-3 pr-8"
                    >
                        <option value="ALL">All Statuses</option>
                        <option value="NOT_REVIEWED">Not Reviewed</option>
                        <option value="TEAM_REVIEWED">Team Reviewed</option>
                        <option value="ADMIN_REVIEWED">Admin Reviewed</option>
                        <option value="MISSING_ADDED">Missing Added</option>
                        <option value="PRE_PUBLISH_READY">Pre-Publish Ready</option>
                        <option value="SOLUTION_REVIEW">Solution Review</option>
                        <option value="PRODUCTION">Production</option>
                        <option value="NOT_WORTHY">Not Worthy</option>
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <label htmlFor="qcount-filter" className="text-sm font-semibold text-gray-700">Questions:</label>
                    <select
                        id="qcount-filter"
                        value={qcount}
                        onChange={(e) => handleFilterChange(exam, e.target.value, status)}
                        className="text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 py-1.5 pl-3 pr-8"
                    >
                        <option value="ALL">All</option>
                        <option value="lt100">Less than 100</option>
                        <option value="gte100">100 or more</option>
                    </select>
                </div>
            </div>

            {(exam !== 'ALL' || qcount !== 'ALL' || status !== 'ALL') && (
                <button
                    onClick={() => handleFilterChange('ALL', 'ALL', 'ALL')}
                    className="text-sm text-gray-500 hover:text-red-600 font-medium whitespace-nowrap"
                >
                    Clear Filters
                </button>
            )}
        </div>
    );
}
