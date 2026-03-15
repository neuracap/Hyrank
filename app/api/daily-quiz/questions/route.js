import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

// GET: Fetch questions for a quiz
export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const quiz_id = searchParams.get('quiz_id');
    const mode = searchParams.get('mode');

    if (!quiz_id) {
        return NextResponse.json({ error: 'quiz_id required' }, { status: 400 });
    }

    try {
        // For public access, verify quiz is approved/published
        if (mode !== 'admin') {
            const quizCheck = await db.query(
                `SELECT status FROM daily_quiz WHERE quiz_id = $1`,
                [quiz_id]
            );
            if (!quizCheck.rows[0] || !['APPROVED', 'PUBLISHED'].includes(quizCheck.rows[0].status)) {
                return NextResponse.json({ error: 'Quiz not available' }, { status: 404 });
            }
        } else {
            const user = await getCurrentUser();
            if (!user?.isAdmin) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        const result = await db.query(`
            SELECT * FROM daily_quiz_question
            WHERE quiz_id = $1
            ORDER BY question_order ASC
        `, [quiz_id]);

        // For public mode, strip correct_option and explanation
        if (mode !== 'admin') {
            const publicQuestions = result.rows.map(q => ({
                question_id: q.question_id,
                question_order: q.question_order,
                question_text_en: q.question_text_en,
                question_text_hi: q.question_text_hi,
                option_a_en: q.option_a_en, option_a_hi: q.option_a_hi,
                option_b_en: q.option_b_en, option_b_hi: q.option_b_hi,
                option_c_en: q.option_c_en, option_c_hi: q.option_c_hi,
                option_d_en: q.option_d_en, option_d_hi: q.option_d_hi,
            }));
            return NextResponse.json({ questions: publicQuestions });
        }

        return NextResponse.json({ questions: result.rows });

    } catch (e) {
        console.error('Quiz questions fetch error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// POST: Add/update a question in a quiz
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const {
            quiz_id, question_id, question_order,
            question_text_en, question_text_hi,
            option_a_en, option_a_hi,
            option_b_en, option_b_hi,
            option_c_en, option_c_hi,
            option_d_en, option_d_hi,
            correct_option,
            explanation_en, explanation_hi
        } = await req.json();

        if (!quiz_id || !correct_option) {
            return NextResponse.json({ error: 'quiz_id and correct_option required' }, { status: 400 });
        }

        if (question_id) {
            // Update existing
            await db.query(`
                UPDATE daily_quiz_question SET
                    question_order = $2,
                    question_text_en = $3, question_text_hi = $4,
                    option_a_en = $5, option_a_hi = $6,
                    option_b_en = $7, option_b_hi = $8,
                    option_c_en = $9, option_c_hi = $10,
                    option_d_en = $11, option_d_hi = $12,
                    correct_option = $13,
                    explanation_en = $14, explanation_hi = $15
                WHERE question_id = $1
            `, [
                question_id, question_order,
                question_text_en || '', question_text_hi || '',
                option_a_en || '', option_a_hi || '',
                option_b_en || '', option_b_hi || '',
                option_c_en || '', option_c_hi || '',
                option_d_en || '', option_d_hi || '',
                correct_option,
                explanation_en || '', explanation_hi || ''
            ]);

            return NextResponse.json({ success: true, question_id });
        } else {
            // Get next order
            const orderRes = await db.query(
                `SELECT COALESCE(MAX(question_order), 0) + 1 as next_order FROM daily_quiz_question WHERE quiz_id = $1`,
                [quiz_id]
            );
            const nextOrder = question_order || orderRes.rows[0].next_order;

            const result = await db.query(`
                INSERT INTO daily_quiz_question
                (quiz_id, question_order, question_text_en, question_text_hi,
                 option_a_en, option_a_hi, option_b_en, option_b_hi,
                 option_c_en, option_c_hi, option_d_en, option_d_hi,
                 correct_option, explanation_en, explanation_hi, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
                RETURNING question_id
            `, [
                quiz_id, nextOrder,
                question_text_en || '', question_text_hi || '',
                option_a_en || '', option_a_hi || '',
                option_b_en || '', option_b_hi || '',
                option_c_en || '', option_c_hi || '',
                option_d_en || '', option_d_hi || '',
                correct_option,
                explanation_en || '', explanation_hi || ''
            ]);

            return NextResponse.json({ success: true, question_id: result.rows[0].question_id });
        }

    } catch (e) {
        console.error('Quiz question save error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// DELETE: Remove a question
export async function DELETE(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { question_id } = await req.json();
        if (!question_id) {
            return NextResponse.json({ error: 'question_id required' }, { status: 400 });
        }

        await db.query('DELETE FROM daily_quiz_question WHERE question_id = $1', [question_id]);
        return NextResponse.json({ success: true });
    } catch (e) {
        console.error('Quiz question delete error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
