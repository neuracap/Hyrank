'use client';

import { useState } from 'react';
import Link from 'next/link';
import { updateReviewStatus, updatePdfLink } from '@/app/dashboard/actions';

export default function DashboardTable({ sessions }) {
    const [editingPdf, setEditingPdf] = useState(null); // sessionId being edited
    const [pdfInput, setPdfInput] = useState('');

    const handleStatusChange = async (sessionId, key, checked) => {
        try {
            await updateReviewStatus(sessionId, key, checked);
        } catch (e) {
            alert('Failed to update status');
        }
    };

    const startPdfEdit = (session) => {
        setEditingPdf(session.id);
        setPdfInput(session.pdf_link || '');
    };

    const savePdfLink = async (sessionId) => {
        try {
            await updatePdfLink(sessionId, pdfInput);
            setEditingPdf(null);
        } catch (e) {
            alert('Failed to update PDF link');
        }
    };

    return (
        <div className="overflow-x-auto bg-white shadow-md rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Exam Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shift</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lang</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Qs Count</th>

                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PDF</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Review Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {sessions.map((session) => (
                        <tr key={session.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 max-w-[200px] truncate" title={session.exam_name}>
                                {session.exam_name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {new Date(session.paper_date).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 max-w-[200px] truncate" title={session.session_label}>
                                {session.session_label}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {session.languages}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {session.question_count}
                            </td>

                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {editingPdf === session.id ? (
                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="text"
                                            value={pdfInput}
                                            onChange={(e) => setPdfInput(e.target.value)}
                                            className="border rounded px-2 py-1 text-xs w-32"
                                            placeholder="https://..."
                                        />
                                        <button onClick={() => savePdfLink(session.id)} className="text-green-600 no-underline text-lg">✓</button>
                                        <button onClick={() => setEditingPdf(null)} className="text-red-600 no-underline text-lg">✗</button>
                                    </div>
                                ) : (
                                    <div className="flex items-center space-x-2">
                                        {session.pdf_link ? (
                                            <a href={session.pdf_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
                                                Link
                                            </a>
                                        ) : (
                                            <span className="text-gray-400 italic text-xs">No link</span>
                                        )}
                                        <button onClick={() => startPdfEdit(session)} className="text-gray-400 hover:text-gray-600">✎</button>
                                    </div>
                                )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                <div className="flex flex-col space-y-2">
                                    <label className="inline-flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                        <input
                                            type="checkbox"
                                            checked={session.questions_checked || false}
                                            onChange={(e) => handleStatusChange(session.id, 'questions_checked', e.target.checked)}
                                            className="form-checkbox h-4 w-4 text-blue-600 rounded"
                                        />
                                        <span>Qs Checked</span>
                                    </label>
                                    <label className="inline-flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                        <input
                                            type="checkbox"
                                            checked={session.answers_checked || false}
                                            onChange={(e) => handleStatusChange(session.id, 'answers_checked', e.target.checked)}
                                            className="form-checkbox h-4 w-4 text-green-600 rounded"
                                        />
                                        <span>Ans Checked</span>
                                    </label>
                                </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                <div className="flex flex-col space-y-2">
                                    <Link
                                        href={`/?testId=${session.id}&mode=test`}
                                        className="text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded text-center text-xs shadow-sm transition-colors"
                                    >
                                        Review Qs
                                    </Link>
                                    <Link
                                        href={`/?testId=${session.id}&mode=solution`}
                                        className="text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded text-center text-xs shadow-sm transition-colors"
                                    >
                                        Review Ans
                                    </Link>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
