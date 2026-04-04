import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/social/current-affairs?status=NEW&category=ALL&limit=50
 * List current affairs items.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'ALL';
    const category = searchParams.get('category') || 'ALL';
    const limit = parseInt(searchParams.get('limit') || '50');

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (status !== 'ALL') {
        conditions.push(`status = $${paramIdx}`);
        params.push(status);
        paramIdx++;
    }
    if (category !== 'ALL') {
        conditions.push(`category = $${paramIdx}`);
        params.push(category);
        paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const res = await db.query(`
            SELECT * FROM current_affairs
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT $${paramIdx}
        `, [...params, limit]);

        return NextResponse.json({ items: res.rows });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

/**
 * POST /api/social/current-affairs
 * Update a current affairs item (status, is_selected) or add to daily quiz.
 * Body: { id, action: 'approve'|'reject'|'add_to_quiz', quiz_date?, level? }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, action, quiz_date, level } = await req.json();
    if (!id || !action) {
        return NextResponse.json({ error: 'id and action required' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        if (action === 'approve') {
            await client.query(`UPDATE current_affairs SET status = 'APPROVED', is_selected = true WHERE id = $1`, [id]);
            return NextResponse.json({ success: true });
        }

        if (action === 'reject') {
            await client.query(`UPDATE current_affairs SET status = 'REJECTED' WHERE id = $1`, [id]);
            return NextResponse.json({ success: true });
        }

        if (action === 'add_to_quiz') {
            if (!quiz_date || !level) {
                return NextResponse.json({ error: 'quiz_date and level required for add_to_quiz' }, { status: 400 });
            }

            // Get the current affairs item
            const itemRes = await client.query(`SELECT * FROM current_affairs WHERE id = $1`, [id]);
            if (itemRes.rows.length === 0) {
                return NextResponse.json({ error: 'Item not found' }, { status: 404 });
            }
            const item = itemRes.rows[0];
            const mcq = item.mcq_json || {};

            await client.query('BEGIN');

            // Get or create daily_quiz for this date+level
            let quizId;
            const quizRes = await client.query(
                `SELECT quiz_id FROM daily_quiz WHERE quiz_date = $1 AND level = $2`,
                [quiz_date, level]
            );

            if (quizRes.rows.length > 0) {
                quizId = quizRes.rows[0].quiz_id;
            } else {
                const newQuiz = await client.query(
                    `INSERT INTO daily_quiz (quiz_date, level, status, created_by) VALUES ($1, $2, 'DRAFT', $3) RETURNING quiz_id`,
                    [quiz_date, level, user.id]
                );
                quizId = newQuiz.rows[0].quiz_id;
            }

            // Get next question_order
            const orderRes = await client.query(
                `SELECT COALESCE(MAX(question_order), 0) + 1 AS next_order FROM daily_quiz_question WHERE quiz_id = $1`,
                [quizId]
            );
            const nextOrder = orderRes.rows[0].next_order;

            // Insert question
            await client.query(`
                INSERT INTO daily_quiz_question
                (quiz_id, question_order, question_text_en, option_a_en, option_b_en, option_c_en, option_d_en,
                 correct_option, explanation_en)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                quizId, nextOrder,
                mcq.question_en || item.headline,
                mcq.option_a || '', mcq.option_b || '', mcq.option_c || '', mcq.option_d || '',
                mcq.correct || 'A',
                mcq.explanation || item.exam_relevance || '',
            ]);

            // Mark as used
            await client.query(`UPDATE current_affairs SET status = 'USED', is_selected = true WHERE id = $1`, [id]);

            await client.query('COMMIT');

            return NextResponse.json({ success: true, quiz_id: quizId, question_order: nextOrder });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
