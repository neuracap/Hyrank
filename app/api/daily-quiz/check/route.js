import { NextResponse } from 'next/server';
import db from '@/lib/db';

// POST: Check answer for a question (public)
export async function POST(req) {
    try {
        const { question_id, selected_option } = await req.json();

        if (!question_id || !selected_option) {
            return NextResponse.json({ error: 'question_id and selected_option required' }, { status: 400 });
        }

        const result = await db.query(`
            SELECT dqq.correct_option, dqq.explanation_en, dqq.explanation_hi
            FROM daily_quiz_question dqq
            JOIN daily_quiz dq ON dqq.quiz_id = dq.quiz_id
            WHERE dqq.question_id = $1 AND dq.status IN ('APPROVED', 'PUBLISHED')
        `, [question_id]);

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Question not found' }, { status: 404 });
        }

        const { correct_option, explanation_en, explanation_hi } = result.rows[0];
        const is_correct = selected_option === correct_option;

        return NextResponse.json({
            is_correct,
            correct_option,
            explanation_en,
            explanation_hi
        });

    } catch (e) {
        console.error('Answer check error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
