'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';

export default function DashboardFilters({ subjects }) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const currentSubject = searchParams.get('subject') || 'ALL';
    const currentStatus = searchParams.get('status') || 'ALL';

    const [subject, setSubject] = useState(currentSubject);
    const [status, setStatus] = useState(currentStatus);

    useEffect(() => {
        setSubject(searchParams.get('subject') || 'ALL');
        setStatus(searchParams.get('status') || 'ALL');
    }, [searchParams]);

    const handleFilterChange = (newSubject, newStatus) => {
        setSubject(newSubject);
        setStatus(newStatus);

        const params = new URLSearchParams(searchParams);

        if (newSubject !== 'ALL') {
            params.set('subject', newSubject);
        } else {
            params.delete('subject');
        }

        if (newStatus !== 'ALL') {
            params.set('status', newStatus);
        } else {
            params.delete('status');
        }

        // Reset to page 1 on filter change
        params.delete('page');

        router.push(`/dashboard?${params.toString()}`);
    };

    return (
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2">
                    <label htmlFor="subject-filter" className="text-sm font-semibold text-gray-700">Exam:</label>
                    <select
                        id="subject-filter"
                        value={subject}
                        onChange={(e) => handleFilterChange(e.target.value, status)}
                        className="text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 py-1.5 pl-3 pr-8"
                    >
                        <option value="ALL">All Exams</option>
                        {subjects.map(sub => (
                            <option key={sub} value={sub}>{sub}</option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <label htmlFor="status-filter" className="text-sm font-semibold text-gray-700">Status:</label>
                    <select
                        id="status-filter"
                        value={status}
                        onChange={(e) => handleFilterChange(subject, e.target.value)}
                        className="text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 py-1.5 pl-3 pr-8"
                    >
                        <option value="ALL">All Statuses</option>
                        <option value="NOT_REVIEWED">1. Not Reviewed</option>
                        <option value="TEAM_REVIEWED">2. Team Reviewed</option>
                        <option value="ADMIN_REVIEWED">3. Admin Reviewed</option>
                        <option value="MISSING_ADDED">4. Missing Added</option>
                        <option value="PRE_PUBLISH_READY">5. Pre-Publish Ready</option>
                        <option value="SOLUTION_REVIEW">6. Solution Review</option>
                        <option value="PRODUCTION">7. Production</option>
                    </select>
                </div>
            </div>

            {(subject !== 'ALL' || status !== 'ALL') && (
                <button
                    onClick={() => handleFilterChange('ALL', 'ALL')}
                    className="text-sm text-gray-500 hover:text-red-600 font-medium whitespace-nowrap"
                >
                    Clear Filters ✕
                </button>
            )}
        </div>
    );
}
