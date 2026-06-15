import { NextResponse } from 'next/server';
import db from '@/lib/db';
import crypto from 'crypto';

/**
 * POST /api/question/create-bilingual
 *
 * Modes:
 *   - 'both' (default) — insert a new EN row + a new HI row and link them.
 *     Requires both english+hindi payloads and both session ids.
 *   - 'english_only' — insert only an EN row into eng_session_id. If
 *     hin_session_id is provided and the same question_number_int exists
 *     on the HI side without a link, auto-link them.
 *   - 'hindi_only' — insert only a HI row into hin_session_id. If
 *     eng_session_id is provided and the same question_number_int exists
 *     on the EN side without a link, auto-link them.
 */
export async function POST(req) {
    const client = await db.connect();

    try {
        const body = await req.json();
        const {
            eng_session_id,
            hin_session_id,
            section_name,
            source_question_no,
            english,
            hindi,
            correct_option_label,
            difficulty,
        } = body;
        const mode = body.mode || 'both';

        const VALID_MODES = ['both', 'english_only', 'hindi_only'];
        if (!VALID_MODES.includes(mode)) {
            return NextResponse.json({ error: `mode must be one of ${VALID_MODES.join(', ')}` }, { status: 400 });
        }

        const needsEnglish = mode === 'both' || mode === 'english_only';
        const needsHindi   = mode === 'both' || mode === 'hindi_only';

        if (needsEnglish && (!eng_session_id || !english)) {
            return NextResponse.json({ error: 'eng_session_id and english payload required for this mode' }, { status: 400 });
        }
        if (needsHindi && (!hin_session_id || !hindi)) {
            return NextResponse.json({ error: 'hin_session_id and hindi payload required for this mode' }, { status: 400 });
        }

        const VALID_LABELS = ['A', 'B', 'C', 'D'];
        if (correct_option_label && !VALID_LABELS.includes(correct_option_label)) {
            return NextResponse.json({ error: 'correct_option_label must be A, B, C, or D' }, { status: 400 });
        }
        let parsedDifficulty = null;
        if (difficulty != null && difficulty !== '') {
            parsedDifficulty = Number(difficulty);
            if (!Number.isInteger(parsedDifficulty) || parsedDifficulty < 1 || parsedDifficulty > 4) {
                return NextResponse.json({ error: 'difficulty must be an integer 1-4' }, { status: 400 });
            }
        }

        // Resolve section against the paper session we know we have.
        const sectionLookupSessionId = eng_session_id || hin_session_id;
        let exam_section_id = null;
        let sectionCode = null;
        let sectionName = null;
        if (section_name && sectionLookupSessionId) {
            const secRes = await client.query(`
                SELECT s.section_id, s.code, s.name
                FROM exam_section s
                JOIN paper_session ps ON s.exam_id = ps.exam_id
                WHERE ps.paper_session_id = $1
                  AND (LOWER(s.code) = LOWER($2) OR LOWER(s.name) = LOWER($2))
                LIMIT 1
            `, [sectionLookupSessionId, section_name]);
            if (secRes.rows.length > 0) {
                exam_section_id = secRes.rows[0].section_id;
                sectionCode = secRes.rows[0].code;
                sectionName = secRes.rows[0].name;
            }
        }

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
            ...(sectionName && { section_name: sectionName }),
        };

        const insertSide = async (language, sessionId, payload) => {
            const qid = crypto.randomUUID();
            await client.query(
                `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
                [qid]
            );
            await client.query(`
                INSERT INTO question_version
                (question_id, version_no, language, status, paper_session_id, exam_section_id, body_json, question_type, has_image, source_question_no, question_number_int, meta_json, correct_option_label, difficulty, created_at, updated_at)
                VALUES ($1, 1, $2, 'draft', $3, $4, $5, 'MCQ', false, $6, $7, $8, $9, $10, NOW(), NOW())
            `, [qid, language, sessionId, exam_section_id, { text: payload.text || '' }, qNo, qNoInt, metaJson, correct_option_label || null, parsedDifficulty]);

            for (const [key, text] of Object.entries(payload.options || {})) {
                const isCorrect = !!(correct_option_label && key === correct_option_label);
                await client.query(`
                    INSERT INTO question_option (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                    VALUES ($1, 1, $2, $3, $4, $5, NOW())
                `, [qid, language, key, { text: text || '' }, isCorrect]);
            }
            return qid;
        };

        // Look up the existing counterpart's question_id when we're inserting one side only.
        // Match on (paper_session_id, question_number_int, language) and reject if the
        // counterpart is already linked — we don't want to silently rewire established links.
        const findUnlinkedCounterpart = async (sessionId, language) => {
            if (!sessionId || qNoInt == null) return null;
            const linkSide = language === 'EN' ? 'english_question_id' : 'hindi_question_id';
            const sideSession = language === 'EN' ? 'paper_session_id_english' : 'paper_session_id_hindi';
            const res = await client.query(`
                SELECT qv.question_id, qv.version_no
                FROM question_version qv
                WHERE qv.paper_session_id = $1
                  AND qv.language = $2
                  AND qv.question_number_int = $3
                  AND NOT EXISTS (
                      SELECT 1 FROM question_links ql
                      WHERE ql.${linkSide} = qv.question_id
                        AND ql.${sideSession} = $1
                  )
                ORDER BY qv.version_no DESC
                LIMIT 1
            `, [sessionId, language, qNoInt]);
            return res.rows[0] || null;
        };

        await client.query('BEGIN');

        let engQuestionId = null;
        let hinQuestionId = null;
        let linkedTo = null; // 'existing_en' | 'existing_hi' | null

        if (mode === 'both') {
            engQuestionId = await insertSide('EN', eng_session_id, english);
            hinQuestionId = await insertSide('HI', hin_session_id, hindi);
            await client.query(`
                INSERT INTO question_links
                (english_question_id, english_version_no, english_language,
                 hindi_question_id, hindi_version_no, hindi_language,
                 paper_session_id_english, paper_session_id_hindi,
                 similarity_score, updated_score, status, created_at)
                VALUES ($1, 1, 'EN', $2, 1, 'HI', $3, $4, 1.0, 1.0, 'MANUALLY_CORRECTED', NOW())
            `, [engQuestionId, hinQuestionId, eng_session_id, hin_session_id]);
        } else if (mode === 'english_only') {
            engQuestionId = await insertSide('EN', eng_session_id, english);
            // Try to link to an existing HI counterpart in hin_session_id.
            const existingHi = hin_session_id ? await findUnlinkedCounterpart(hin_session_id, 'HI') : null;
            if (existingHi) {
                await client.query(`
                    INSERT INTO question_links
                    (english_question_id, english_version_no, english_language,
                     hindi_question_id, hindi_version_no, hindi_language,
                     paper_session_id_english, paper_session_id_hindi,
                     similarity_score, updated_score, status, created_at)
                    VALUES ($1, 1, 'EN', $2, $3, 'HI', $4, $5, 1.0, 1.0, 'MANUALLY_CORRECTED', NOW())
                `, [engQuestionId, existingHi.question_id, existingHi.version_no, eng_session_id, hin_session_id]);
                hinQuestionId = existingHi.question_id;
                linkedTo = 'existing_hi';
            }
        } else if (mode === 'hindi_only') {
            hinQuestionId = await insertSide('HI', hin_session_id, hindi);
            const existingEn = eng_session_id ? await findUnlinkedCounterpart(eng_session_id, 'EN') : null;
            if (existingEn) {
                await client.query(`
                    INSERT INTO question_links
                    (english_question_id, english_version_no, english_language,
                     hindi_question_id, hindi_version_no, hindi_language,
                     paper_session_id_english, paper_session_id_hindi,
                     similarity_score, updated_score, status, created_at)
                    VALUES ($1, $2, 'EN', $3, 1, 'HI', $4, $5, 1.0, 1.0, 'MANUALLY_CORRECTED', NOW())
                `, [existingEn.question_id, existingEn.version_no, hinQuestionId, eng_session_id, hin_session_id]);
                engQuestionId = existingEn.question_id;
                linkedTo = 'existing_en';
            }
        }

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            mode,
            engQuestionId,
            hinQuestionId,
            sourceQuestionNo: qNo,
            linkedTo,
        });

    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error creating bilingual question:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
