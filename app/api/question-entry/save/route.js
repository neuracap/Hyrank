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
            group_id,
            group_order,
            subtype,
            solution_text,
            ca_period,
            english,
            hindi
        } = await req.json();

        if (!english?.text && !hindi?.text) {
            return NextResponse.json({ error: 'At least one language must have question text' }, { status: 400 });
        }

        await client.query('BEGIN');

        const sectionId = exam_section_id || null;
        const diff = difficulty || null;
        const gId = group_id || null;
        const gOrder = group_order || null;

        // Normalize source_question_no to Q.XX format
        const rawQNo = source_question_no ? String(source_question_no).trim() : null;
        let qNo = rawQNo;
        let qNoInt = null;
        if (rawQNo) {
            const numMatch = rawQNo.replace(/[^0-9]/g, '');
            if (numMatch) {
                qNo = rawQNo.startsWith('Q.') ? rawQNo : `Q.${numMatch}`;
                qNoInt = parseInt(numMatch, 10);
            }
        }

        // Look up section_code and section_name for meta_json
        let sectionCode = null;
        let sectionName = null;
        if (sectionId) {
            const secRes = await client.query(
                `SELECT code, name FROM exam_section WHERE section_id = $1`,
                [sectionId]
            );
            if (secRes.rows.length > 0) {
                sectionCode = secRes.rows[0].code;
                sectionName = secRes.rows[0].name;
            }
        }

        const subtypeVal = subtype || null;
        const solutionJson = solution_text ? { solution_text } : null;
        const hasImageEn = (english?.text || '').includes('\\includegraphics');
        const hasImageHi = (hindi?.text || '').includes('\\includegraphics');

        const metaJson = {
            source: 'manual',
            created_by: user.id,
            ...(sectionCode && { section_code: sectionCode }),
            ...(sectionName && { section_name: sectionName }),
            ...(ca_period && { ca_period }),
        };

        // --- English Question ---
        const engQuestionId = crypto.randomUUID();
        await client.query(
            `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
            [engQuestionId]
        );

        await client.query(`
            INSERT INTO question_version
            (question_id, version_no, language, status, paper_session_id, exam_section_id,
             body_json, solution_json, question_type, has_image, source_question_no, question_number_int,
             difficulty, subtype, meta_json, group_id, group_order, created_at, updated_at)
            VALUES ($1, 1, 'EN', 'MANUALLY_CORRECTED', NULL, $2, $3, $4, 'MCQ', $5, $6, $7,
                    $8, $9, $10, $11, $12, NOW(), NOW())
        `, [
            engQuestionId,
            sectionId,
            { text: english.text || '' },
            solutionJson,
            hasImageEn,
            qNo,
            qNoInt,
            diff,
            subtypeVal,
            metaJson,
            gId,
            gOrder
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
             body_json, solution_json, question_type, has_image, source_question_no, question_number_int,
             difficulty, subtype, meta_json, group_id, group_order, created_at, updated_at)
            VALUES ($1, 1, 'HI', 'MANUALLY_CORRECTED', NULL, $2, $3, $4, 'MCQ', $5, $6, $7,
                    $8, $9, $10, $11, $12, NOW(), NOW())
        `, [
            hinQuestionId,
            sectionId,
            { text: hindi.text || '' },
            solutionJson,
            hasImageHi,
            qNo,
            qNoInt,
            diff,
            subtypeVal,
            metaJson,
            gId,
            gOrder
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
