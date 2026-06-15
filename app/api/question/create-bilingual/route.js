import { NextResponse } from 'next/server';
import db from '@/lib/db';
import crypto from 'crypto';

export async function POST(req) {
    const client = await db.connect();

    try {
        const body = await req.json();
        const { eng_session_id, hin_session_id, section_name, source_question_no, english, hindi, correct_option_label, difficulty } = body;

        if (!eng_session_id || !hin_session_id || !english || !hindi) {
            return NextResponse.json({ error: 'Missing required fields: eng_session_id, hin_session_id, english, hindi' }, { status: 400 });
        }
        const validLabels = ['A', 'B', 'C', 'D'];
        if (correct_option_label && !validLabels.includes(correct_option_label)) {
            return NextResponse.json({ error: 'correct_option_label must be A, B, C, or D' }, { status: 400 });
        }
        let parsedDifficulty = null;
        if (difficulty != null && difficulty !== '') {
            parsedDifficulty = Number(difficulty);
            if (!Number.isInteger(parsedDifficulty) || parsedDifficulty < 1 || parsedDifficulty > 4) {
                return NextResponse.json({ error: 'difficulty must be an integer 1-4' }, { status: 400 });
            }
        }

        // Resolve Section ID, code, and name (if provided)
        let exam_section_id = null;
        let sectionCode = null;
        let sectionName = null;
        if (section_name) {
            const secRes = await client.query(`
                SELECT s.section_id, s.code, s.name
                FROM exam_section s
                JOIN paper_session ps ON s.exam_id = ps.exam_id
                WHERE ps.paper_session_id = $1
                AND (LOWER(s.code) = LOWER($2) OR LOWER(s.name) = LOWER($2))
                LIMIT 1
            `, [eng_session_id, section_name]);

            if (secRes.rows.length > 0) {
                exam_section_id = secRes.rows[0].section_id;
                sectionCode = secRes.rows[0].code;
                sectionName = secRes.rows[0].name;
            }
        }

        await client.query('BEGIN');

        // Normalize source_question_no to Q.XX format
        const rawQNo = source_question_no ? String(source_question_no).trim() : null;
        let qNo = rawQNo || 'Q.New';
        let qNoInt = null;
        if (rawQNo) {
            const numMatch = rawQNo.replace(/[^0-9]/g, '');
            if (numMatch) {
                qNo = rawQNo.startsWith('Q.') ? rawQNo : `Q.${numMatch}`;
                qNoInt = parseInt(numMatch, 10);
            }
        }

        const metaJson = {
            source: 'manual',
            ...(sectionCode && { section_code: sectionCode }),
            ...(sectionName && { section_name: sectionName })
        };

        // --- English ---
        const engQuestionId = crypto.randomUUID();
        await client.query(
            `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
            [engQuestionId]
        );

        await client.query(`
            INSERT INTO question_version
            (question_id, version_no, language, status, paper_session_id, exam_section_id, body_json, question_type, has_image, source_question_no, question_number_int, meta_json, correct_option_label, difficulty, created_at, updated_at)
            VALUES ($1, 1, 'EN', 'draft', $2, $3, $4, 'MCQ', false, $5, $6, $7, $8, $9, NOW(), NOW())
        `, [engQuestionId, eng_session_id, exam_section_id, { text: english.text || '' }, qNo, qNoInt, metaJson, correct_option_label || null, parsedDifficulty]);

        // Insert English options
        for (const [key, text] of Object.entries(english.options || {})) {
            const isCorrect = !!(correct_option_label && key === correct_option_label);
            await client.query(`
                INSERT INTO question_option (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                VALUES ($1, 1, 'EN', $2, $3, $4, NOW())
            `, [engQuestionId, key, { text: text || '' }, isCorrect]);
        }

        // --- Hindi ---
        const hinQuestionId = crypto.randomUUID();
        await client.query(
            `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
            [hinQuestionId]
        );

        await client.query(`
            INSERT INTO question_version
            (question_id, version_no, language, status, paper_session_id, exam_section_id, body_json, question_type, has_image, source_question_no, question_number_int, meta_json, correct_option_label, difficulty, created_at, updated_at)
            VALUES ($1, 1, 'HI', 'draft', $2, $3, $4, 'MCQ', false, $5, $6, $7, $8, $9, NOW(), NOW())
        `, [hinQuestionId, hin_session_id, exam_section_id, { text: hindi.text || '' }, qNo, qNoInt, metaJson, correct_option_label || null, parsedDifficulty]);

        // Insert Hindi options
        for (const [key, text] of Object.entries(hindi.options || {})) {
            const isCorrect = !!(correct_option_label && key === correct_option_label);
            await client.query(`
                INSERT INTO question_option (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                VALUES ($1, 1, 'HI', $2, $3, $4, NOW())
            `, [hinQuestionId, key, { text: text || '' }, isCorrect]);
        }

        // --- Link them ---
        await client.query(`
            INSERT INTO question_links
            (english_question_id, english_version_no, english_language,
             hindi_question_id, hindi_version_no, hindi_language,
             paper_session_id_english, paper_session_id_hindi,
             similarity_score, updated_score, status, created_at)
            VALUES ($1, 1, 'EN', $2, 1, 'HI', $3, $4, 1.0, 1.0, 'MANUALLY_CORRECTED', NOW())
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
