import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export async function POST(request) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { question_id, version_no, answer_label, solution_text } = body;
    if (!question_id || version_no == null) {
        return NextResponse.json({ error: 'question_id and version_no are required' }, { status: 400 });
    }
    if (!answer_label) {
        return NextResponse.json({ error: 'answer_label is required' }, { status: 400 });
    }

    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');

        // Build solution_json
        const solutionJson = JSON.stringify({
            answer_label,
            solution_text: solution_text || null,
            updated_at: new Date().toISOString(),
            reviewed_by: user.id,
        });

        // Update question_version solution_json
        await client.query(`
            UPDATE question_version
            SET
                solution_json = $1::jsonb,
                updated_at = NOW()
            WHERE question_id = $2
              AND version_no = $3
        `, [solutionJson, question_id, version_no]);

        // Mark correct option in EN
        await client.query(`
            UPDATE question_option
            SET is_correct = (option_key = $1)
            WHERE question_id = $2
              AND language = 'EN'
        `, [answer_label, question_id]);

        // Also mark correct option in HI (same question_id)
        await client.query(`
            UPDATE question_option
            SET is_correct = (option_key = $1)
            WHERE question_id = $2
              AND language = 'HI'
        `, [answer_label, question_id]);

        await client.query('COMMIT');
        return NextResponse.json({ success: true });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('image-solutions/save error:', error);
        return NextResponse.json({ error: 'Failed to save solution', details: error.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
