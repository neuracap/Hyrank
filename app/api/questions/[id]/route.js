import db from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request, { params }) {
    const { id } = await params;

    try {
        const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);

        if (!question) {
            return NextResponse.json({ error: 'Question not found' }, { status: 404 });
        }

        const options = db.prepare('SELECT * FROM options WHERE question_id = ? ORDER BY opt_label ASC').all(id);
        const llmSolutions = db.prepare('SELECT * FROM llm_solutions WHERE question_id = ?').all(id);

        return NextResponse.json({
            question,
            options,
            llmSolutions
        });
    } catch (error) {
        console.error('Database error:', error);
        return NextResponse.json({ error: 'Failed to fetch question details' }, { status: 500 });
    }
}

export async function PUT(request, { params }) {
    const { id } = await params;
    const body = await request.json();

    const {
        question_text,
        has_figure,
        figure_path,
        exclude_from_final,
        difficulty,
        difficulty_level,
        approx_time_seconds,
        subject,
        topic,
        sub_topic,
        concept_tags,
        exam,
        exam_date,
        shift,
        section,
        soft_skill_tag,
        solution_style_tags,
        trap_option_label,
        trap_explanation_1line,
        question_source,
        final_answer_label,
        final_answer_text,
        final_solution_text,
        final_solution_source,
        review_status,
        options
    } = body;

    try {
        const updateQuestion = db.prepare(`
            UPDATE questions SET
                question_text = @question_text,
                has_figure = @has_figure,
                figure_path = @figure_path,
                difficulty = @difficulty,
                difficulty_level = @difficulty_level,
                approx_time_seconds = @approx_time_seconds,
                subject = @subject,
                topic = @topic,
                sub_topic = @sub_topic,
                concept_tags = @concept_tags,
                exam = @exam,
                exam_date = @exam_date,
                shift = @shift,
                section = @section,
                soft_skill_tag = @soft_skill_tag,
                solution_style_tags = @solution_style_tags,
                trap_option_label = @trap_option_label,
                trap_explanation_1line = @trap_explanation_1line,
                question_source = @question_source,
                final_answer_label = @final_answer_label,
                final_answer_text = @final_answer_text,
                final_solution_text = @final_solution_text,
                final_solution_source = @final_solution_source,
                review_status = @review_status
            WHERE id = @id
        `);

        db.transaction(() => {
            updateQuestion.run({
                id,
                question_text,
                has_figure: has_figure ? 1 : 0,
                figure_path,
                difficulty,
                difficulty_level,
                approx_time_seconds,
                subject,
                topic,
                sub_topic,
                concept_tags,
                exam,
                exam_date,
                shift,
                section,
                soft_skill_tag,
                solution_style_tags,
                trap_option_label,
                trap_explanation_1line,
                question_source,
                final_answer_label,
                final_answer_text,
                final_solution_text,
                final_solution_source,
                review_status
            });

            if (options && Array.isArray(options)) {
                const updateOption = db.prepare('UPDATE options SET opt_text = @opt_text WHERE id = @id');
                for (const opt of options) {
                    if (opt.id) {
                        updateOption.run({ id: opt.id, opt_text: opt.opt_text });
                    }
                }
            }
        })();

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Database error:', error);
        return NextResponse.json({ error: 'Failed to update question: ' + error.message }, { status: 500 });
    }
}
