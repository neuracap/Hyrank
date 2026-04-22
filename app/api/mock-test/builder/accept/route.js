import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/mock-test/builder/accept
 * Accept a question into the mock test.
 * Creates a COPY of the source question as a new question_id (paper_session_id = NULL).
 * mock_test_question points to this new question — edits go directly to question_version.
 * Provenance stored in meta_json.source_question_id.
 *
 * Body: { mock_test_id, source_question_id, section_id }
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

    const { mock_test_id, source_question_id, section_id } = body;
    if (!mock_test_id || !source_question_id || !section_id) {
        return NextResponse.json({ error: 'mock_test_id, source_question_id, section_id are required' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Load source question
        const srcRes = await client.query(`
            SELECT qv.*, ps.session_label, ps.paper_date, e.name AS exam_name, e.code AS exam_code
            FROM question_version qv
            JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            JOIN exam e ON e.exam_id = ps.exam_id
            WHERE qv.question_id = $1 AND qv.language = 'EN'
            LIMIT 1
        `, [source_question_id]);

        if (srcRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Source question not found' }, { status: 404 });
        }
        const src = srcRes.rows[0];

        // 2. Load source options
        const optsRes = await client.query(`
            SELECT option_key, option_json, is_correct
            FROM question_option
            WHERE question_id = $1 AND language = 'EN'
            ORDER BY option_key ASC
        `, [source_question_id]);

        // 3. Create new question_version (copy)
        const newQuestionId = (await client.query('SELECT gen_random_uuid() AS id')).rows[0].id;

        const meta = {
            ...(src.meta_json || {}),
            source_question_id,
            source_exam:    src.exam_name,
            source_exam_code: src.exam_code,
            source_session: src.session_label,
            source_date:    src.paper_date,
        };

        await client.query(`
            INSERT INTO question_version (
                question_id, version_no, language, status,
                paper_session_id, exam_section_id,
                body_json, solution_json, question_type,
                subtype, difficulty, has_image, correct_option_label,
                source_question_no, meta_json, created_at, updated_at
            ) VALUES (
                $1, 1, 'EN', 'MANUALLY_CORRECTED',
                NULL, $2,
                $3, $4, $5,
                $6, $7, $8, $9,
                $10, $11, NOW(), NOW()
            )
        `, [
            newQuestionId, section_id,
            src.body_json, src.solution_json, src.question_type || 'MCQ',
            src.subtype, src.difficulty, src.has_image, src.correct_option_label,
            src.source_question_no, JSON.stringify(meta),
        ]);

        // 4. Copy options
        for (const opt of optsRes.rows) {
            await client.query(`
                INSERT INTO question_option (question_id, version_no, language, option_key, option_json, is_correct)
                VALUES ($1, 1, 'EN', $2, $3, $4)
            `, [newQuestionId, opt.option_key, opt.option_json, opt.is_correct]);
        }

        // 5. Get next position for this section
        const posRes = await client.query(`
            SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
            FROM mock_test_question
            WHERE mock_test_id = $1 AND exam_section_id = $2
        `, [mock_test_id, section_id]);
        const position = posRes.rows[0].next_pos;

        // 6. Insert into mock_test_question pointing to the NEW question
        await client.query(`
            INSERT INTO mock_test_question
                (mock_test_id, question_id, exam_section_id, position,
                 slot_subtype, slot_difficulty, review_status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', NOW())
        `, [mock_test_id, newQuestionId, section_id, position, src.subtype || null, src.difficulty || null]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            new_question_id: newQuestionId,
            position,
        });

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
 * Remove a question from the mock test (and delete the copied question_version).
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

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        // Remove from mock test
        await client.query(`DELETE FROM mock_test_question WHERE mock_test_id = $1 AND question_id = $2`, [mock_test_id, question_id]);
        // Delete the copied question (options cascade or delete explicitly)
        await client.query(`DELETE FROM question_option WHERE question_id = $1`, [question_id]);
        await client.query(`DELETE FROM question_version WHERE question_id = $1`, [question_id]);
        await client.query('COMMIT');
        return NextResponse.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('mock-test/builder/accept DELETE error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
