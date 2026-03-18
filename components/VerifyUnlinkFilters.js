'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';

export default function VerifyUnlinkFilters({ exams, sections }) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const currentExam = searchParams.get('exam') || 'ALL';
    const currentSection = searchParams.get('section') || 'ALL';

    const [exam, setExam] = useState(currentExam);
    const [section, setSection] = useState(currentSection);

    useEffect(() => {
        setExam(searchParams.get('exam') || 'ALL');
        setSection(searchParams.get('section') || 'ALL');
    }, [searchParams]);

    // Filter sections based on selected exam
    const filteredSections = exam === 'ALL'
        ? sections
        : sections.filter(s => s.exam_name === exam);

    const handleFilterChange = (newExam, newSection) => {
        // Reset section if exam changed
        if (newExam !== exam) newSection = 'ALL';
        setExam(newExam);
        setSection(newSection);

        const params = new URLSearchParams();
        if (newExam !== 'ALL') params.set('exam', newExam);
        if (newSection !== 'ALL') params.set('section', newSection);
        // Reset to page 1 on filter change
        router.push(`/verify-unlink?${params.toString()}`);
    };

    return (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-6 py-4 mb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2">
                    <label htmlFor="vu-exam-filter" className="text-sm font-semibold text-gray-700">Exam:</label>
                    <select
                        id="vu-exam-filter"
                        value={exam}
                        onChange={(e) => handleFilterChange(e.target.value, section)}
                        className="text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 py-1.5 pl-3 pr-8"
                    >
                        <option value="ALL">All Exams</option>
                        {exams.map(e => (
                            <option key={e} value={e}>{e}</option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <label htmlFor="vu-section-filter" className="text-sm font-semibold text-gray-700">Section:</label>
                    <select
                        id="vu-section-filter"
                        value={section}
                        onChange={(e) => handleFilterChange(exam, e.target.value)}
                        className="text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 py-1.5 pl-3 pr-8"
                    >
                        <option value="ALL">All Sections</option>
                        {filteredSections.map(s => (
                            <option key={s.section_id} value={s.section_id}>{s.section_name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {(exam !== 'ALL' || section !== 'ALL') && (
                <button
                    onClick={() => handleFilterChange('ALL', 'ALL')}
                    className="text-sm text-gray-500 hover:text-red-600 font-medium whitespace-nowrap"
                >
                    Clear Filters
                </button>
            )}
        </div>
    );
}
