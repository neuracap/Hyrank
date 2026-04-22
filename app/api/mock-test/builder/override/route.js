import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/mock-test/builder/override
 * Save edits (question text, options, solution, difficulty) for an accepted question.
 * Stored in mock_test_question.override_json — never touches the original question_version.
 *
 * Body: {
 *   mock_test_id,
 *   question_id,
 *   question_text?,
 *   options?,          — [{ key, text }]
 *   correct_option?,
 *   solution_text?,
 *   difficulty?,       — 1 | 2 | 3
 * }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { mock_test_id, question_id, question_text, options, correct_option, solution_text, difficulty } = body;
    if (!mock_test_id || !question_id) {
        return NextResponse.json({ error: 'mock_test_id and question_id are required' }, { status: 400 });
    }

    try {
        // Build override_json: only include fields that were actually sent
        const override = {};
        if (question_text !== undefined) override.question_text = question_text;
        if (options      !== undefined) override.options       = options;
        if (correct_option !== undefined) override.correct_option = correct_option;
        if (solution_text  !== undefined) override.solution_text  = solution_text;
        if (difficulty     !== undefined) override.difficulty     = difficulty;

        await db.query(`
            UPDATE mock_test_question
            SET
                override_json  = $3::jsonb,
                slot_difficulty = COALESCE($4, slot_difficulty),
                updated_at      = NOW()
            WHERE mock_test_id = $1 AND question_id = $2
        `, [mock_test_id, question_id, JSON.stringify(override), difficulty || null]);

        return NextResponse.json({ success: true });

    } catch (e) {
        console.error('mock-test/builder/override error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
