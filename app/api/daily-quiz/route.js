import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

// GET: List quizzes (admin) or get today's published quizzes (public)
export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode'); // 'admin' or default (public)
    const date = searchParams.get('date');
    const level = searchParams.get('level');

    try {
        if (mode === 'admin') {
            const user = await getCurrentUser();
            if (!user?.isAdmin) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }

            // Fetch all quizzes for admin, optionally filtered
            let query = `
                SELECT dq.*, u.name as creator_name, au.name as approver_name,
                       (SELECT COUNT(*) FROM daily_quiz_question dqq WHERE dqq.quiz_id = dq.quiz_id) as question_count
                FROM daily_quiz dq
                LEFT JOIN users u ON dq.created_by = u.id
                LEFT JOIN users au ON dq.approved_by = au.id
            `;
            const params = [];
            const conditions = [];

            if (date) {
                params.push(date);
                conditions.push(`dq.quiz_date = $${params.length}`);
            }
            if (level) {
                params.push(level);
                conditions.push(`dq.level = $${params.length}`);
            }

            if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
            query += ' ORDER BY dq.quiz_date DESC, dq.level ASC';

            const result = await db.query(query, params);
            return NextResponse.json({ quizzes: result.rows });
        }

        // Public: get today's or specified date's approved/published quizzes
        const quizDate = date || new Date().toISOString().split('T')[0];
        const query = `
            SELECT dq.quiz_id, dq.quiz_date, dq.level, dq.status
            FROM daily_quiz dq
            WHERE dq.quiz_date = $1 AND dq.status IN ('APPROVED', 'PUBLISHED')
            ORDER BY
                CASE dq.level WHEN 'SSC' THEN 1 WHEN 'BANKING' THEN 2 WHEN 'UPSC' THEN 3 END
        `;
        const result = await db.query(query, [quizDate]);
        return NextResponse.json({ quizzes: result.rows, date: quizDate });

    } catch (e) {
        console.error('Daily quiz fetch error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// POST: Create a new quiz
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { quiz_date, level } = await req.json();

        if (!quiz_date || !level) {
            return NextResponse.json({ error: 'quiz_date and level are required' }, { status: 400 });
        }

        if (!['UPSC', 'SSC', 'BANKING'].includes(level)) {
            return NextResponse.json({ error: 'level must be UPSC, SSC, or BANKING' }, { status: 400 });
        }

        const result = await db.query(`
            INSERT INTO daily_quiz (quiz_date, level, status, created_by, created_at)
            VALUES ($1, $2, 'DRAFT', $3, NOW())
            RETURNING quiz_id, quiz_date, level, status
        `, [quiz_date, level, user.id]);

        return NextResponse.json({ success: true, quiz: result.rows[0] });

    } catch (e) {
        if (e.code === '23505') {
            return NextResponse.json({ error: 'A quiz already exists for this date and level' }, { status: 409 });
        }
        console.error('Daily quiz create error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// PATCH: Update quiz status (approve/publish)
export async function PATCH(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { quiz_id, status } = await req.json();

        if (!quiz_id || !status) {
            return NextResponse.json({ error: 'quiz_id and status required' }, { status: 400 });
        }

        if (!['DRAFT', 'APPROVED', 'PUBLISHED'].includes(status)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
        }

        const updates = [`status = $1`];
        const params = [status, quiz_id];

        if (status === 'APPROVED' || status === 'PUBLISHED') {
            updates.push(`approved_by = $3`, `approved_at = NOW()`);
            params.push(user.id);
        }

        await db.query(`
            UPDATE daily_quiz SET ${updates.join(', ')} WHERE quiz_id = $2
        `, params);

        return NextResponse.json({ success: true });

    } catch (e) {
        console.error('Daily quiz update error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
