import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import crypto from 'crypto';

export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await db.connect();

    try {
        const {
            exam_section_id,
            difficulty,
            source_question_no,
            correct_answer,
            english,
            hindi
        } = await req.json();

        if (!english?.text && !hindi?.text) {
            return NextResponse.json({ error: 'At least one language must have question text' }, { status: 400 });
        }

        await client.query('BEGIN');

        const qNo = source_question_no || null;
        const sectionId = exam_section_id || null;
        const diff = difficulty || null;

        // --- English Question ---
        const engQuestionId = crypto.randomUUID();
        await client.query(
            `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
            [engQuestionId]
        );

        await client.query(`
            INSERT INTO question_version
            (question_id, version_no, language, status, paper_session_id, exam_section_id,
             body_json, question_type, has_image, source_question_no, difficulty,
             meta_json, created_at, updated_at)
            VALUES ($1, 1, 'EN', 'MANUALLY_CORRECTED', NULL, $2, $3, 'MCQ', false, $4, $5,
                    $6, NOW(), NOW())
        `, [
            engQuestionId,
            sectionId,
            { text: english.text || '' },
            qNo,
            diff,
            { source: 'manual', created_by: user.id }
        ]);

        // Insert English options
        for (const key of ['A', 'B', 'C', 'D']) {
            await client.query(`
                INSERT INTO question_option
                (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                VALUES ($1, 1, 'EN', $2, $3, $4, NOW())
            `, [
                engQuestionId,
                key,
                { text: (english.options && english.options[key]) || '' },
                correct_answer === key
            ]);
        }

        // --- Hindi Question ---
        const hinQuestionId = crypto.randomUUID();
        await client.query(
            `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
            [hinQuestionId]
        );

        await client.query(`
            INSERT INTO question_version
            (question_id, version_no, language, status, paper_session_id, exam_section_id,
             body_json, question_type, has_image, source_question_no, difficulty,
             meta_json, created_at, updated_at)
            VALUES ($1, 1, 'HI', 'MANUALLY_CORRECTED', NULL, $2, $3, 'MCQ', false, $4, $5,
                    $6, NOW(), NOW())
        `, [
            hinQuestionId,
            sectionId,
            { text: hindi.text || '' },
            qNo,
            diff,
            { source: 'manual', created_by: user.id }
        ]);

        // Insert Hindi options
        for (const key of ['A', 'B', 'C', 'D']) {
            await client.query(`
                INSERT INTO question_option
                (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                VALUES ($1, 1, 'HI', $2, $3, $4, NOW())
            `, [
                hinQuestionId,
                key,
                { text: (hindi.options && hindi.options[key]) || '' },
                correct_answer === key
            ]);
        }

        // --- Link them ---
        await client.query(`
            INSERT INTO question_links
            (english_question_id, english_version_no, english_language,
             hindi_question_id, hindi_version_no, hindi_language,
             paper_session_id_english, paper_session_id_hindi,
             similarity_score, updated_score, status, created_at)
            VALUES ($1, 1, 'EN', $2, 1, 'HI', NULL, NULL, 1.0, 1.0, 'MANUALLY_CORRECTED', NOW())
        `, [engQuestionId, hinQuestionId]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            engQuestionId,
            hinQuestionId,
            sourceQuestionNo: qNo
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error creating question:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
