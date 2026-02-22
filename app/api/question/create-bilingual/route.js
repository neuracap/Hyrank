import { NextResponse } from 'next/server';
import db from '@/lib/db';
import crypto from 'crypto';

export async function POST(req) {
    const client = await db.connect();

    try {
        const body = await req.json();
        const { eng_session_id, hin_session_id, section_name, source_question_no, english, hindi } = body;

        if (!eng_session_id || !hin_session_id || !english || !hindi) {
            return NextResponse.json({ error: 'Missing required fields: eng_session_id, hin_session_id, english, hindi' }, { status: 400 });
        }

        // Resolve Section ID (if provided)
        let exam_section_id = null;
        if (section_name) {
            const secRes = await client.query(`
                SELECT s.section_id 
                FROM exam_section s
                JOIN paper_session ps ON s.exam_id = ps.exam_id
                WHERE ps.paper_session_id = $1 
                AND (LOWER(s.code) = LOWER($2) OR LOWER(s.name) = LOWER($2))
                LIMIT 1
            `, [eng_session_id, section_name]);

            if (secRes.rows.length > 0) {
                exam_section_id = secRes.rows[0].section_id;
            }
        }

        await client.query('BEGIN');

        const qNo = source_question_no || 'Q.New';

        // --- English ---
        const engQuestionId = crypto.randomUUID();
        await client.query(
            `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
            [engQuestionId]
        );

        await client.query(`
            INSERT INTO question_version 
            (question_id, version_no, language, status, paper_session_id, exam_section_id, body_json, question_type, has_image, source_question_no, created_at, updated_at)
            VALUES ($1, 1, 'EN', 'draft', $2, $3, $4, 'MCQ', false, $5, NOW(), NOW())
        `, [engQuestionId, eng_session_id, exam_section_id, { text: english.text || '' }, qNo]);

        // Insert English options
        for (const [key, text] of Object.entries(english.options || {})) {
            await client.query(`
                INSERT INTO question_option (question_id, version_no, language, option_key, option_json, is_correct, created_at, updated_at)
                VALUES ($1, 1, 'EN', $2, $3, false, NOW(), NOW())
            `, [engQuestionId, key, { text: text || '' }]);
        }

        // --- Hindi ---
        const hinQuestionId = crypto.randomUUID();
        await client.query(
            `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
            [hinQuestionId]
        );

        await client.query(`
            INSERT INTO question_version 
            (question_id, version_no, language, status, paper_session_id, exam_section_id, body_json, question_type, has_image, source_question_no, created_at, updated_at)
            VALUES ($1, 1, 'HI', 'draft', $2, $3, $4, 'MCQ', false, $5, NOW(), NOW())
        `, [hinQuestionId, hin_session_id, exam_section_id, { text: hindi.text || '' }, qNo]);

        // Insert Hindi options
        for (const [key, text] of Object.entries(hindi.options || {})) {
            await client.query(`
                INSERT INTO question_option (question_id, version_no, language, option_key, option_json, is_correct, created_at, updated_at)
                VALUES ($1, 1, 'HI', $2, $3, false, NOW(), NOW())
            `, [hinQuestionId, key, { text: text || '' }]);
        }

        // --- Link them ---
        await client.query(`
            INSERT INTO question_links
            (english_question_id, english_version_no, hindi_question_id, hindi_version_no, 
             hindi_language, paper_session_id_english, paper_session_id_hindi,
             similarity_score, updated_score, status, created_at)
            VALUES ($1, 1, $2, 1, 'HI', $3, $4, 1.0, 1.0, 'MANUALLY_CORRECTED', NOW())
        `, [engQuestionId, hinQuestionId, eng_session_id, hin_session_id]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            engQuestionId,
            hinQuestionId,
            sourceQuestionNo: qNo
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error creating bilingual question:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
