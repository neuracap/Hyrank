import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

/**
 * POST /api/solution-review/toggle-figure
 * Toggle solution_figure_helpful for a question.
 * Body: { question_id, version_no, language, value (boolean) }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { question_id, version_no, language, value } = await req.json();
    if (!question_id) {
        return NextResponse.json({ error: 'question_id is required' }, { status: 400 });
    }

    try {
        await db.query(`
            UPDATE question_version
            SET solution_figure_helpful = $1,
                updated_at = NOW()
            WHERE question_id = $2
              AND version_no = COALESCE($3, 1)
              AND language = COALESCE($4, 'EN')
        `, [!!value, question_id, version_no || 1, language || 'EN']);

        return NextResponse.json({ success: true, value: !!value });
    } catch (e) {
        console.error('solution-review/toggle-figure error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
