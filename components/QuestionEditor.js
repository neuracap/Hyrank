'use client';

import { useState, useEffect } from 'react';
import Latex from './Latex';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function QuestionEditor({ initialData, initialOptions, initialSolutions }) {
    const router = useRouter();
    const [question, setQuestion] = useState(initialData);
    const [options, setOptions] = useState(initialOptions);
    // We assume only one LLM solution for now, or we pick the first one.
    const [llmSolution, setLlmSolution] = useState(initialSolutions[0] || {});

    useEffect(() => {
        setLlmSolution(initialSolutions[0] || {});
    }, [initialSolutions]);

    const [loading, setLoading] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');
    const [editMode, setEditMode] = useState(false); // Toggle for Question/Options

    // Local state for edits
    const [formState, setFormState] = useState({
        question_text: question.question_text || '',
        figure_path: question.figure_path || '',
        has_figure: !!question.has_figure,
        difficulty: question.difficulty || '',
        difficulty_level: question.difficulty_level || 3, // Default mid level
        approx_time_seconds: question.approx_time_seconds || 60,
        subject: question.subject || '',
        topic: question.topic || '',
        sub_topic: question.sub_topic || '',
        concept_tags: question.concept_tags || '',

        // Exam Metadata
        exam: question.exam || '',
        exam_date: question.exam_date || '',
        shift: question.shift || '',
        section: question.section || '',

        // Tags
        soft_skill_tag: question.soft_skill_tag || '',
        trap_option_label: question.trap_option_label || '',
        trap_explanation_1line: question.trap_explanation_1line || '',
        question_source: question.question_source || '',

        // Status & Final
        review_status: question.review_status?.toLowerCase() || 'good',
        final_answer_label: question.final_answer_label || '',
        final_solution_text: question.final_solution_text || '',
    });

    const [optionState, setOptionState] = useState(initialOptions);

    useEffect(() => {
        setQuestion(initialData);
        setOptions(initialOptions);
        setOptionState(initialOptions);
        setFormState({
            question_text: initialData.question_text || '',
            figure_path: initialData.figure_path || '',
            has_figure: !!initialData.has_figure,
            difficulty: initialData.difficulty || '',
            difficulty_level: initialData.difficulty_level || 3,
            approx_time_seconds: initialData.approx_time_seconds || 60,
            subject: initialData.subject || '',
            topic: initialData.topic || '',
            sub_topic: initialData.sub_topic || '',
            concept_tags: initialData.concept_tags || '',
            exam: initialData.exam || '',
            exam_date: initialData.exam_date || '',
            shift: initialData.shift || '',
            section: initialData.section || '',
            soft_skill_tag: initialData.soft_skill_tag || '',
            trap_option_label: initialData.trap_option_label || '',
            trap_explanation_1line: initialData.trap_explanation_1line || '',
            question_source: initialData.question_source || '',
            review_status: initialData.review_status?.toLowerCase() || (initialData.keep_status?.toLowerCase() || 'good'),
            final_answer_label: initialData.final_answer_label || '',
            final_solution_text: initialData.final_solution_text || '',
        });
        // Reset edit mode on nav
        setEditMode(false);
        setSuccessMsg('');
    }, [initialData, initialOptions]); // dependency on data objects

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormState(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const setField = (name, value) => {
        setFormState(prev => ({ ...prev, [name]: value }));
    };

    const handleOptionChange = (index, field, value) => {
        const newOptions = [...optionState];
        newOptions[index] = { ...newOptions[index], [field]: value };
        setOptionState(newOptions);
    };

    const copyLLMSolution = () => {
        if (llmSolution.llm_solution_text) {
            setFormState(prev => ({
                ...prev,
                final_solution_text: llmSolution.llm_solution_text
            }));
        }
    };

    const saveQuestion = async () => {
        setLoading(true);
        setSuccessMsg('');
        try {
            const res = await fetch(`/api/questions/${question.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formState,
                    options: optionState
                })
            });

            if (!res.ok) throw new Error('Failed to save');

            setSuccessMsg('Saved successfully!');
            setTimeout(() => setSuccessMsg(''), 1500);
            setEditMode(false); // Exit edit mode on save
        } catch (err) {
            alert('Error saving question: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const navigate = (dir) => {
        const currentId = question.id;
        const nextId = dir === 'prev' ? currentId - 1 : currentId + 1;
        if (nextId > 0) router.push(`/question/${nextId}`);
    };

    // Segmented Control Component
    const SegmentedControl = ({ options, value, onChange, colorMap = {} }) => {
        return (
            <div className="segmented-control">
                {options.map((opt) => {
                    const isActive = String(value).toLowerCase() === String(opt.value).toLowerCase();
                    const activeColor = isActive && colorMap[opt.value] ? colorMap[opt.value] : '';
                    return (
                        <div
                            key={opt.value}
                            onClick={() => onChange(opt.value)}
                            className={`segmented-item ${isActive ? 'active' : ''}`}
                            style={isActive && activeColor ? { color: 'white', backgroundColor: activeColor, borderColor: activeColor } : {}}
                        >
                            {opt.label}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="container-xl">
            {/* Header / Nav */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <Link href="/" className="text-secondary hover:text-primary font-medium text-sm">← Back to Dashboard</Link>
                </div>
                <div className="text-center">
                    <span className="text-sm font-bold text-gray-400 uppercase tracking-widest">Question Editor</span>
                </div>
                <div className="text-secondary text-sm font-mono">
                    ID: <span className="font-bold text-gray-800">{question.id}</span> | Q#<span className="font-bold text-gray-800">{question.q_no}</span>
                </div>
            </div>

            {successMsg && (
                <div className="mb-4 p-4 bg-green-50 text-green-700 rounded-md border border-green-200 font-medium text-center">
                    {successMsg}
                </div>
            )}

            <div className="space-y-6">

                {/* ROW 1: Question (Left) vs Metadata (Right) */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

                    {/* LEFT COL: Question Card */}
                    <div className="card relative group flex flex-col h-full min-w-0">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="section-header">Question Content</h3>
                            {!editMode && (
                                <button
                                    onClick={() => setEditMode(true)}
                                    className="text-gray-400 hover:text-blue-600 transition-colors"
                                    title="Edit Question"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                    </svg>
                                </button>
                            )}
                        </div>

                        {editMode ? (
                            <div className="flex-1 flex flex-col gap-6">
                                <div className="flex-1 flex flex-col">
                                    <label className="label">Question Text (LaTeX supported)</label>
                                    <div className="flex-1 grid grid-rows-2 gap-4 h-[400px]">
                                        <textarea
                                            name="question_text"
                                            value={formState.question_text}
                                            onChange={handleInputChange}
                                            className="textarea font-mono text-sm leading-relaxed resize-none h-full"
                                            placeholder="Type your question here..."
                                        />
                                        <div className="overflow-y-auto bg-white p-4 rounded-md border border-gray-200 text-sm leading-relaxed shadow-inner">
                                            <span className="text-xs font-bold text-gray-300 block mb-2 uppercase">Live Preview</span>
                                            <Latex>{formState.question_text}</Latex>
                                        </div>
                                    </div>
                                    <div className="p-4 bg-gray-50 rounded-md border border-gray-200 mt-4">
                                        <h4 className="label mb-2">Figure Configuration</h4>
                                        <div className="flex gap-4 items-center">
                                            <div className="flex items-center gap-2">
                                                <input type="checkbox" checked={formState.has_figure} name="has_figure" onChange={handleInputChange} id="has_figure" className="w-4 h-4 text-blue-600 rounded" />
                                                <label htmlFor="has_figure" className="text-sm font-medium text-gray-700">Has Figure</label>
                                            </div>
                                            <input
                                                type="text"
                                                name="figure_path"
                                                value={formState.figure_path}
                                                onChange={handleInputChange}
                                                className="input flex-1"
                                                placeholder="/assets/images/..."
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h4 className="label mb-2">Options Configuration</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        {optionState.map((opt, idx) => (
                                            <div key={idx} className="p-3 border border-gray-100 rounded-lg bg-gray-50/50">
                                                <div className="flex gap-2 items-center mb-2">
                                                    <div className="w-8 h-8 flex items-center justify-center font-bold bg-white border border-gray-200 rounded text-gray-500 text-sm shrink-0 shadow-sm">
                                                        {opt.opt_label}
                                                    </div>
                                                    <input
                                                        value={opt.opt_text || ''}
                                                        onChange={(e) => handleOptionChange(idx, 'opt_text', e.target.value)}
                                                        className="input font-mono text-xs flex-1"
                                                        placeholder={`Option ${opt.opt_label}`}
                                                    />
                                                </div>
                                                <div className="pl-10 text-sm text-gray-700 min-h-[1.5rem]">
                                                    <Latex>{opt.opt_text || ''}</Latex>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-6 flex justify-end">
                                        <button onClick={() => setEditMode(false)} className="btn btn-primary">
                                            Done Editing
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            // PREVIEW MODE
                            <div className="flex-1 flex flex-col">
                                <div className="prose prose-lg max-w-none question-text mb-3">
                                    <Latex>{formState.question_text}</Latex>
                                </div>

                                {formState.figure_path && (
                                    <div className="my-4 p-4 bg-gray-50 border border-1 border-gray-200 rounded-lg text-center">
                                        <span className="text-xs text-gray-400 font-medium block mb-2 uppercase tracking-wide">Figure</span>
                                        <div className="flex justify-center mb-2">
                                            <img
                                                src={formState.figure_path}
                                                alt="Question Figure"
                                                className="max-h-64 object-contain rounded border border-gray-200 shadow-sm"
                                                onError={(e) => {
                                                    e.target.style.display = 'none';
                                                    e.target.nextSibling.style.display = 'block';
                                                }}
                                            />
                                            <div className="hidden p-4 bg-red-50 text-red-600 rounded text-sm">
                                                ⚠️ Image failed to load
                                            </div>
                                        </div>
                                        <code className="text-[10px] bg-gray-100 px-2 py-1 rounded text-gray-500 font-mono inline-block">{formState.figure_path}</code>
                                    </div>
                                )}

                                <div className="mt-auto">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                                        {optionState.map((opt, idx) => (
                                            <div key={idx} className="flex items-start gap-2 p-2 border border-gray-200 rounded-md bg-white hover:shadow-sm transition-all min-w-0">
                                                <div className="w-5 h-5 mt-0.5 flex items-center justify-center rounded-full bg-gray-100 border border-gray-300 text-[10px] font-bold text-gray-600 shrink-0">
                                                    {opt.opt_label?.toUpperCase()}
                                                </div>
                                                <div className="text-xs text-gray-800 leading-snug min-w-0 break-words">
                                                    <Latex>{opt.opt_text || ''}</Latex>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="mt-4 flex items-center justify-between gap-4 p-2 bg-gray-50 border border-gray-200 rounded-md">
                                    <label className="text-xs font-semibold text-gray-600 shrink-0">Correct Answer</label>
                                    <div className="flex-1">
                                        <SegmentedControl
                                            options={optionState.map(o => ({ label: o.opt_label.toUpperCase(), value: o.opt_label }))}
                                            value={formState.final_answer_label}
                                            onChange={(v) => setField('final_answer_label', v)}
                                            colorMap={{ 'a': '#2563eb', 'b': '#2563eb', 'c': '#2563eb', 'd': '#2563eb' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* RIGHT COL: Metadata Card (Stacked) */}
                    <div className="card h-full min-w-0">
                        <h3 className="section-header border-b border-gray-100 pb-2 mb-4">Metadata</h3>
                        <div className="space-y-6">
                            {/* 1. Metrics */}
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Metrics</h4>
                                <div className="space-y-4">
                                    <div>
                                        <label className="label">Difficulty Level (1-5)</label>
                                        <div className="flex items-center gap-4">
                                            <SegmentedControl
                                                options={[1, 2, 3, 4, 5].map(v => ({ label: v, value: v }))}
                                                value={formState.difficulty_level}
                                                onChange={(v) => setField('difficulty_level', v)}
                                                colorMap={{ 1: '#22c55e', 2: '#84cc16', 3: '#eab308', 4: '#f97316', 5: '#ef4444' }}
                                            />
                                            <div className="relative w-20 shrink-0">
                                                <input type="number" name="approx_time_seconds" value={formState.approx_time_seconds} onChange={handleInputChange} className="input text-center font-mono" />
                                                <span className="absolute right-2 top-2.5 text-xs text-gray-400 font-medium">s</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div><label className="label">Exam</label><input name="exam" value={formState.exam} onChange={handleInputChange} className="input" placeholder="Exam Name" /></div>
                                </div>
                            </div>

                            {/* 2. Taxonomy */}
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Taxonomy</h4>
                                <div className="space-y-3">
                                    <div><label className="label">Subject</label><input name="subject" value={formState.subject} onChange={handleInputChange} className="input" /></div>
                                    <div><label className="label">Topic</label><input name="topic" value={formState.topic} onChange={handleInputChange} className="input" /></div>
                                    <div><label className="label">Sub Topic</label><input name="sub_topic" value={formState.sub_topic} onChange={handleInputChange} className="input" /></div>
                                    <div>
                                        <label className="label">Soft Skill</label>
                                        <select name="soft_skill_tag" value={formState.soft_skill_tag} onChange={handleInputChange} className="select text-sm w-full">
                                            <option value="">Select...</option>
                                            <option value="OPTION_ELIM">Option Elimination</option>
                                            <option value="MENTAL_CALC">Mental Calculation</option>
                                            <option value="PERCENT_RATIO_FRACTIONS_COMPARE">Percent/Ratio/Fractions</option>
                                            <option value="GEOM_VISUAL">Geometry Visualization</option>
                                            <option value="APPROXIMATE">Approximation</option>
                                            <option value="BACK-SOLVING">Back-Solving</option>
                                            <option value="PATTERN_SPOT">Pattern Spotting</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* 3. Advanced */}
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Advanced</h4>
                                <div className="space-y-3">
                                    <div><label className="label">Concept Tags</label><input name="concept_tags" value={formState.concept_tags} onChange={handleInputChange} className="input text-sm" placeholder="Tags..." /></div>
                                    <div className="bg-red-50 p-2 rounded border border-red-100">
                                        <label className="label !text-red-800 text-xs">Trap</label>
                                        <div className="flex gap-2">
                                            <input name="trap_option_label" value={formState.trap_option_label} onChange={handleInputChange} className="input w-16 text-center uppercase text-xs" placeholder="Opt" />
                                            <input name="trap_explanation_1line" value={formState.trap_explanation_1line} onChange={handleInputChange} className="input flex-1 text-xs" placeholder="Explanation" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ROW 2: Solution Split - unified comparison card */}
                <div className="card min-w-0">
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                        <h3 className="section-header !mb-0">Solutions Review</h3>
                        <button
                            onClick={copyLLMSolution}
                            className="text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 px-2 py-1 rounded transition-colors"
                        >
                            Use LLM → Final
                        </button>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        {/* LLM */}
                        <div className="flex flex-col h-[560px] min-w-0">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">LLM Solution</span>
                            </div>
                            <div className="flex-1 overflow-y-auto bg-gray-50 p-4 rounded-md border border-gray-200 text-sm leading-relaxed">
                                <Latex>{llmSolution.llm_solution_text || ''}</Latex>
                            </div>
                        </div>

                        {/* Final */}
                        <div className="flex flex-col h-[560px] min-w-0">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-green-600 uppercase tracking-wider">Final Solution</span>
                            </div>

                            <div className="flex-1 grid grid-rows-2 gap-3">
                                <textarea
                                    name="final_solution_text"
                                    value={formState.final_solution_text}
                                    onChange={handleInputChange}
                                    className="textarea text-sm font-mono resize-none bg-white focus:bg-white"
                                    placeholder="Final solution (LaTeX enabled)..."
                                />
                                <div className="overflow-y-auto bg-white p-4 rounded-md border border-gray-200 text-sm leading-relaxed shadow-inner">
                                    <span className="text-xs font-bold text-gray-300 block mb-2 uppercase">Preview</span>
                                    <Latex>{formState.final_solution_text}</Latex>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="flex justify-end items-center gap-6 p-6 bg-white border-t border-gray-200 sticky bottom-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                    <div className="flex items-center gap-4 mr-auto">
                        <button onClick={() => navigate('prev')} className="btn btn-secondary text-gray-600">← Previous</button>
                        <button onClick={() => navigate('next')} className="btn btn-secondary text-gray-600">Next Question →</button>
                    </div>

                    <div className="flex items-center gap-4 bg-gray-100 p-1.5 rounded-lg">
                        {['Dump', 'Okay', 'Good'].map((status) => {
                            const isActive = formState.review_status?.toLowerCase() === status.toLowerCase();
                            let activeClass = '';
                            if (isActive) {
                                if (status === 'Good') activeClass = 'bg-green-600 text-white shadow-md';
                                else if (status === 'Okay') activeClass = 'bg-yellow-500 text-white shadow-md';
                                else activeClass = 'bg-red-600 text-white shadow-md';
                            } else {
                                activeClass = 'bg-transparent text-gray-500 hover:bg-gray-200';
                            }
                            return (
                                <button
                                    key={status}
                                    onClick={() => setField('review_status', status)}
                                    className={`px-6 py-2 rounded-md font-bold text-sm transition-all ${activeClass}`}
                                >
                                    {status}
                                </button>
                            );
                        })}
                    </div>

                    <button onClick={saveQuestion} disabled={loading} className="btn btn-primary px-8 py-3 text-base shadow-lg shadow-blue-200 hover:shadow-blue-300 transform hover:-translate-y-0.5 transition-all">
                        {loading ? 'Saving...' : 'SAVE & NEXT'}
                    </button>
                </div>
            </div>
        </div>
    );
}
