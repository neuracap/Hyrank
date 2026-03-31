import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Section IDs for this exam
const EN_SECTION_IDS = [
    'cad0d299-b84c-4aed-9c2c-ed78e404231d', // REASONING
    'a3518426-02ee-4c92-b053-5548e31d257e', // QUANT
    '9d3d887c-bfeb-446f-bb64-b804c2a06bf2', // GK
];
const HINDI_SECTION_ID = '008f0cb0-81ab-43d0-a4b9-08e5324e65c6';
const ENGLISH_SECTION_ID = '1882c0c1-2614-4653-9f41-695dfc773025';

/**
 * POST /api/paper/split-translate
 *
 * Splits a mixed paper_session into proper EN and HI paper_sessions.
 * All DB operations only — NO translation (fast, no timeout).
 *
 * For Reasoning/Quant/GK questions:
 *   - Creates EN question (copy of original text — already English)
 *   - Creates EN options (copy — already English)
 *   - Keeps original as HI question (text still English — user translates via bilingual page)
 *   - Links EN↔HI via question_links
 *
 * For English section: copies to EN paper only (no HI pair)
 * For Hindi section: stays in HI paper (no EN pair)
 *
 * After split, user opens bilingual page to translate HI questions using
 * the existing "Translate" buttons.
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { paper_session_id } = await req.json();
    if (!paper_session_id) {
        return NextResponse.json({ error: 'paper_session_id is required' }, { status: 400 });
    }

    const client = await db.connect();

    try {
        // 1. Get existing paper_session
        const psRes = await client.query(`
            SELECT ps.*, e.name AS exam_name
            FROM paper_session ps
            LEFT JOIN exam e ON e.exam_id = ps.exam_id
            WHERE ps.paper_session_id = $1
        `, [paper_session_id]);

        if (psRes.rows.length === 0) {
            client.release();
            return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
        }

        const ps = psRes.rows[0];

        // 2. Check for duplicate
        const enSessionLabel = ps.session_label?.replace(/\s*\(HI\)\s*$/i, '').trim() + ' (EN)';
        const existingEnRes = await client.query(`
            SELECT paper_session_id FROM paper_session
            WHERE session_label = $1 AND language = 'EN' AND exam_id = $2
        `, [enSessionLabel, ps.exam_id]);

        if (existingEnRes.rows.length > 0) {
            client.release();
            return NextResponse.json({
                error: 'EN paper already exists',
                en_paper_session_id: existingEnRes.rows[0].paper_session_id,
                bilingual_url: `/bilingual/${existingEnRes.rows[0].paper_session_id}`,
            }, { status: 409 });
        }

        // 3. Fetch all questions + options
        const qRes = await client.query(`
            SELECT question_id, version_no, language, body_json, exam_section_id,
                   status, source_question_no, question_number_int, question_type,
                   has_image, meta_json, group_id, group_order
            FROM question_version
            WHERE paper_session_id = $1
            ORDER BY question_number_int ASC NULLS LAST
        `, [paper_session_id]);

        const qIds = qRes.rows.map(q => q.question_id);
        const optRes = await client.query(`
            SELECT question_id, option_key, option_json, is_correct, language
            FROM question_option WHERE question_id = ANY($1) ORDER BY option_key
        `, [qIds]);

        const optionsByQ = {};
        for (const o of optRes.rows) {
            if (!optionsByQ[o.question_id]) optionsByQ[o.question_id] = [];
            optionsByQ[o.question_id].push(o);
        }

        await client.query('BEGIN');

        // 4. Create EN paper_session
        const enPsId = crypto.randomUUID();
        await client.query(`
            INSERT INTO paper_session
            (paper_session_id, exam_id, tier, paper_date, shift_label,
             session_label, official_source, language, caption, subject,
             shift_number, normalized_time, ai_processed, raw_mmd_doc_id,
             ai_meta_json, meta_json, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN', $8, $9,
                    $10, $11, $12, $13, $14, $15, $16, NOW())
        `, [
            enPsId, ps.exam_id, ps.tier, ps.paper_date, ps.shift_label,
            enSessionLabel, ps.official_source, ps.caption, ps.subject,
            ps.shift_number, ps.normalized_time, ps.ai_processed, ps.raw_mmd_doc_id,
            ps.ai_meta_json, ps.meta_json, ps.status || 'NOT_REVIEWED',
        ]);

        // 5. Update original to HI
        const hiSessionLabel = ps.session_label?.includes('(HI)')
            ? ps.session_label
            : ps.session_label?.replace(/\s*\(EN\)\s*$/i, '').trim() + ' (HI)';
        await client.query(
            `UPDATE paper_session SET language = 'HI', session_label = $2 WHERE paper_session_id = $1`,
            [paper_session_id, hiSessionLabel]
        );

        let processed = 0;
        let copiedEnglish = 0;
        let skippedHindi = 0;
        const errors = [];

        // 6. Process each question
        for (const q of qRes.rows) {
            const sectionId = q.exam_section_id;
            const opts = optionsByQ[q.question_id] || [];

            // Hindi section — leave as-is
            if (sectionId === HINDI_SECTION_ID) {
                skippedHindi++;
                continue;
            }

            // Unknown section
            if (sectionId !== ENGLISH_SECTION_ID && !EN_SECTION_IDS.includes(sectionId)) {
                errors.push(`Q ${q.question_id}: unknown section ${sectionId}`);
                continue;
            }

            try {
                const enQuestionId = crypto.randomUUID();
                const bodyText = q.body_json?.text || '';

                // Create question record
                await client.query(
                    `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
                    [enQuestionId]
                );

                // Create EN question_version in new EN paper
                await client.query(`
                    INSERT INTO question_version
                    (question_id, version_no, language, status, paper_session_id, exam_section_id,
                     body_json, question_type, has_image, source_question_no, question_number_int,
                     meta_json, group_id, group_order, created_at, updated_at)
                    VALUES ($1, 1, 'EN', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                `, [
                    enQuestionId, q.status || 'MANUALLY_CORRECTED', enPsId, sectionId,
                    { text: bodyText }, q.question_type || 'MCQ', q.has_image || false,
                    q.source_question_no, q.question_number_int,
                    { ...(q.meta_json || {}), source: 'split_translate', original_question_id: q.question_id },
                    q.group_id, q.group_order,
                ]);

                // Copy options as EN
                for (const opt of opts) {
                    await client.query(`
                        INSERT INTO question_option
                        (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                        VALUES ($1, 1, 'EN', $2, $3, $4, NOW())
                    `, [enQuestionId, opt.option_key, opt.option_json, opt.is_correct]);
                }

                if (EN_SECTION_IDS.includes(sectionId)) {
                    // Reasoning/Quant/GK — also update original as HI and link
                    // (text stays as-is for now — user translates on bilingual page)
                    await client.query(`
                        UPDATE question_version SET language = 'HI', updated_at = NOW()
                        WHERE question_id = $1 AND version_no = $2
                    `, [q.question_id, q.version_no]);

                    // Update options language to HI
                    await client.query(`
                        UPDATE question_option SET language = 'HI'
                        WHERE question_id = $1
                    `, [q.question_id]);

                    // Link EN↔HI
                    await client.query(`
                        INSERT INTO question_links
                        (english_question_id, english_version_no, english_language,
                         hindi_question_id, hindi_version_no, hindi_language,
                         paper_session_id_english, paper_session_id_hindi,
                         similarity_score, updated_score, status, created_at)
                        VALUES ($1, 1, 'EN', $2, $3, 'HI', $4, $5, 1.0, 1.0, 'MANUALLY_CORRECTED', NOW())
                    `, [enQuestionId, q.question_id, q.version_no, enPsId, paper_session_id]);

                    processed++;
                } else {
                    // English section — EN only, no HI pair
                    copiedEnglish++;
                }
            } catch (e) {
                errors.push(`Q ${q.question_id}: ${e.message}`);
            }
        }

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            en_paper_session_id: enPsId,
            hi_paper_session_id: paper_session_id,
            processed,
            copied_english: copiedEnglish,
            skipped_hindi: skippedHindi,
            errors: errors.slice(0, 20),
            total_questions: qRes.rows.length,
            bilingual_url: `/bilingual/${enPsId}`,
            note: 'Hindi translations not done yet. Open the bilingual page to translate using Translate buttons.',
        });

    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('paper/split-translate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
