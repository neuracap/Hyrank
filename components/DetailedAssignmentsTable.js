'use client';

import { useState, useMemo } from 'react';

export default function DetailedAssignmentsTable({ details }) {
    const [selectedYear, setSelectedYear] = useState('All');
    const [selectedStatus, setSelectedStatus] = useState('All');
    const [selectedReviewer, setSelectedReviewer] = useState('All');

    // Extract unique values for filters
    const years = useMemo(() => {
        const uniqueYears = [...new Set(details.map(d => d.paper_year).filter(Boolean))];
        return ['All', ...uniqueYears.sort((a, b) => b - a)]; // Descending
    }, [details]);

    const statuses = useMemo(() => {
        const uniqueStatuses = [...new Set(details.map(d => d.assignment_status))];
        return ['All', ...uniqueStatuses];
    }, [details]);

    const reviewers = useMemo(() => {
        const uniqueReviewers = [...new Set(details.map(d => d.email))];
        return ['All', ...uniqueReviewers.sort()];
    }, [details]);


    // Filter the details
    const filteredDetails = useMemo(() => {
        return details.filter(row => {
            const matchYear = selectedYear === 'All' || row.paper_year == selectedYear;
            const matchStatus = selectedStatus === 'All' || row.assignment_status === selectedStatus;
            const matchReviewer = selectedReviewer === 'All' || row.email === selectedReviewer;
            return matchYear && matchStatus && matchReviewer;
        });
    }, [details, selectedYear, selectedStatus, selectedReviewer]);

    return (
        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-lg font-bold text-gray-800">Detailed Assignments</h2>
                    <p className="text-xs text-gray-500 mt-1">Showing {filteredDetails.length} of {details.length} assignments</p>
                </div>

                <div className="flex flex-wrap gap-3">
                    {/* Year Filter */}
                    <select
                        className="text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        value={selectedYear}
                        onChange={(e) => setSelectedYear(e.target.value)}
                    >
                        <option value="All">All Years</option>
                        {years.filter(y => y !== 'All').map(year => (
                            <option key={year} value={year}>{year}</option>
                        ))}
                    </select>

                    {/* Status Filter */}
                    <select
                        className="text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        value={selectedStatus}
                        onChange={(e) => setSelectedStatus(e.target.value)}
                    >
                        <option value="All">All Statuses</option>
                        {statuses.filter(s => s !== 'All').map(status => (
                            <option key={status} value={status}>{status}</option>
                        ))}
                    </select>

                    {/* Reviewer Filter */}
                    <select
                        className="text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        value={selectedReviewer}
                        onChange={(e) => setSelectedReviewer(e.target.value)}
                    >
                        <option value="All">All Reviewers</option>
                        {reviewers.filter(r => r !== 'All').map(reviewer => (
                            <option key={reviewer} value={reviewer}>{reviewer}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="p-6 max-h-[600px] overflow-y-auto">
                {filteredDetails.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        No assignments match the selected filters.
                    </div>
                ) : (
                    filteredDetails.map((row, idx) => {
                        const pTotal = parseInt(row.paper_total_q);
                        const pCorrected = parseInt(row.paper_corrected_q);
                        const pPercent = pTotal > 0 ? Math.round((pCorrected / pTotal) * 100) : 0;

                        return (
                            <div key={idx} className="flex flex-col sm:flex-row justify-between items-start sm:items-center py-3 border-b last:border-0 border-gray-100">
                                <div className="mb-2 sm:mb-0">
                                    <div className="flex items-center mb-1">
                                        <span className={`inline-block w-20 text-xs font-bold px-2 py-1 rounded mr-3 text-center ${row.assignment_status === 'COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                                            {row.assignment_status === 'COMPLETED' ? 'DONE' : 'ACTIVE'}
                                        </span>
                                        <span className={`text-xs font-bold px-2 py-[2px] rounded mr-2 border ${row.language === 'EN' ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-orange-200 text-orange-600 bg-orange-50'}`}>
                                            {row.language}
                                        </span>
                                        <span className="text-gray-800 text-sm font-medium truncat max-w-[300px] sm:max-w-md" title={row.paper_name}>
                                            {row.paper_name}
                                        </span>
                                    </div>
                                    <div className="ml-[100px] text-xs text-gray-400">
                                        Assigned to: {row.email} {row.paper_year && `| Year: ${row.paper_year}`}
                                    </div>
                                </div>

                                <div className="flex items-center w-full sm:w-auto ml-[100px] sm:ml-0">
                                    <div className="w-32 mr-3">
                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                            <div
                                                className="bg-green-500 h-2 rounded-full transition-all duration-500"
                                                style={{ width: `${pPercent}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                    <span className="text-sm font-medium text-gray-600 min-w-[80px] text-right">
                                        {pCorrected} / {pTotal}
                                    </span>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
