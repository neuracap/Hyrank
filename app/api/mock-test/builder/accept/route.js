import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/mock-test/builder/accept
 * Accept a question into the mock test for a section.
 * Body: { mock_test_id, question_id, section_id }
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

    const { mock_test_id, question_id, section_id } = body;
    if (!mock_test_id || !question_id || !section_id) {
        return NextResponse.json({ error: 'mock_test_id, question_id, section_id are required' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const posRes = await client.query(`
            SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
            FROM mock_test_question
            WHERE mock_test_id = $1 AND exam_section_id = $2
        `, [mock_test_id, section_id]);
        const position = posRes.rows[0].next_pos;

        const qRes = await client.query(`
            SELECT qv.subtype, qv.difficulty, qv.solution_json,
                   qv.body_json->>'text' AS question_text,
                   qv.correct_option_label
            FROM question_version qv
            WHERE qv.question_id = $1 AND qv.language = 'EN'
            LIMIT 1
        `, [question_id]);
        const qData = qRes.rows[0] || {};

        await client.query(`
            INSERT INTO mock_test_question
                (mock_test_id, question_id, exam_section_id, position,
                 slot_subtype, slot_difficulty, review_status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', NOW())
            ON CONFLICT (mock_test_id, question_id) DO NOTHING
        `, [mock_test_id, question_id, section_id, position,
            qData.subtype || null, qData.difficulty || null]);

        await client.query('COMMIT');
        return NextResponse.json({ success: true, position });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('mock-test/builder/accept error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}

/**
 * DELETE /api/mock-test/builder/accept
 * Remove a question from the mock test.
 * Body: { mock_test_id, question_id }
 */
export async function DELETE(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { mock_test_id, question_id } = body;
    if (!mock_test_id || !question_id) {
        return NextResponse.json({ error: 'mock_test_id and question_id are required' }, { status: 400 });
    }

    try {
        await db.query(`
            DELETE FROM mock_test_question
            WHERE mock_test_id = $1 AND question_id = $2
        `, [mock_test_id, question_id]);
        return NextResponse.json({ success: true });
    } catch (e) {
        console.error('mock-test/builder/accept DELETE error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
