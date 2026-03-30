import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { translate } from 'google-translate-api-x';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — translation takes time

// Section IDs for this exam
const EN_SECTION_IDS = [
    'cad0d299-b84c-4aed-9c2c-ed78e404231d', // REASONING
    'a3518426-02ee-4c92-b053-5548e31d257e', // QUANT
    '9d3d887c-bfeb-446f-bb64-b804c2a06bf2', // GK
];
const HINDI_SECTION_ID = '008f0cb0-81ab-43d0-a4b9-08e5324e65c6';
const ENGLISH_SECTION_ID = '1882c0c1-2614-4653-9f41-695dfc773025';

async function translateText(text) {
    if (!text || !text.trim()) return text || '';
    try {
        // Protect LaTeX
        const placeholders = [];
        const replacer = (match) => { placeholders.push(match); return `__LATEX_${placeholders.length - 1}__`; };
        const patterns = [
            /\[[a-z_]+\]/g,
            /\$[^$]+\$/g,
            /\\\([^\)]+\\\)/g,
            /\\\[[^\]]+\\\]/g,
            /\\[a-zA-Z]+(\{[^}]*\})?/g,
        ];
        let protectedText = text;
        patterns.forEach(p => { protectedText = protectedText.replace(p, replacer); });

        const res = await translate(protectedText, { from: 'en', to: 'hi' });
        let translated = res.text;

        // Restore placeholders
        translated = translated.replace(/__LATEX_(\d+)__/gi, (_, p1) => {
            const idx = parseInt(p1);
            return idx >= 0 && idx < placeholders.length ? placeholders[idx] : _;
        });
        return translated;
    } catch {
        return text;
    }
}

/**
 * POST /api/paper/split-translate
 * Split a mixed paper_session into proper EN and HI paper_sessions.
 *
 * Body: { paper_session_id }
 *
 * What it does:
 * 1. Creates a new EN paper_session
 * 2. For Reasoning/Quant/GK questions (text is EN but tagged HI):
 *    - Creates EN question + question_version in EN paper_session
 *    - Translates text + options to Hindi
 *    - Updates existing HI question_version with translated text
 *    - Links EN↔HI via question_links
 * 3. Hindi section stays as-is in HI paper_session
 * 4. Returns both paper_session_ids
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
        // 1. Get the existing paper_session info
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

        // 2. Check if EN paper_session already exists for this paper
        // (prevent double processing)
        const enSessionLabel = ps.session_label?.replace(/\s*\(HI\)\s*$/i, '').trim() + ' (EN)';
        const existingEnRes = await client.query(`
            SELECT paper_session_id FROM paper_session
            WHERE session_label = $1 AND language = 'EN' AND exam_id = $2
        `, [enSessionLabel, ps.exam_id]);

        if (existingEnRes.rows.length > 0) {
            client.release();
            return NextResponse.json({
                error: 'EN paper_session already exists for this paper',
                en_paper_session_id: existingEnRes.rows[0].paper_session_id,
            }, { status: 409 });
        }

        // 3. Fetch all questions from the mixed paper_session
        const qRes = await client.query(`
            SELECT
                qv.question_id, qv.version_no, qv.language,
                qv.body_json, qv.exam_section_id, qv.status,
                qv.source_question_no, qv.question_number_int,
                qv.question_type, qv.has_image,
                qv.meta_json, qv.group_id, qv.group_order
            FROM question_version qv
            WHERE qv.paper_session_id = $1
            ORDER BY qv.question_number_int ASC NULLS LAST
        `, [paper_session_id]);

        const questions = qRes.rows;

        // Fetch all options
        const qIds = questions.map(q => q.question_id);
        const optRes = await client.query(`
            SELECT question_id, option_key, option_json, is_correct, language
            FROM question_option
            WHERE question_id = ANY($1)
            ORDER BY option_key
        `, [qIds]);

        const optionsByQ = {};
        for (const o of optRes.rows) {
            if (!optionsByQ[o.question_id]) optionsByQ[o.question_id] = [];
            optionsByQ[o.question_id].push(o);
        }

        await client.query('BEGIN');

        // 4. Create new EN paper_session with all fields from original
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

        // 5. Update original paper_session to confirm HI language + label
        const hiSessionLabel = ps.session_label?.includes('(HI)') ? ps.session_label : ps.session_label?.replace(/\s*\(EN\)\s*$/i, '').trim() + ' (HI)';
        await client.query(`
            UPDATE paper_session SET language = 'HI', session_label = $2 WHERE paper_session_id = $1
        `, [paper_session_id, hiSessionLabel]);

        let processed = 0;
        let skippedHindi = 0;
        let copiedEnglish = 0;
        let errors = [];

        // 6. Separate questions by section type
        const enQuestions = []; // Reasoning/Quant/GK — need split + translate
        const englishSectionQuestions = []; // English section — copy to EN only, no translation
        for (const q of questions) {
            if (q.exam_section_id === HINDI_SECTION_ID) { skippedHindi++; continue; }
            if (q.exam_section_id === ENGLISH_SECTION_ID) { englishSectionQuestions.push(q); continue; }
            if (!EN_SECTION_IDS.includes(q.exam_section_id)) { errors.push(`Q ${q.question_id}: unknown section`); continue; }
            enQuestions.push(q);
        }

        // 7. Translate all texts in parallel BEFORE the DB transaction
        //    Batch: for each question, translate body + all option texts concurrently
        const BATCH_SIZE = 5; // 5 questions at a time
        const translationResults = new Map(); // questionId -> { hiBody, hiOpts: {key: text} }

        for (let i = 0; i < enQuestions.length; i += BATCH_SIZE) {
            const batch = enQuestions.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (q) => {
                try {
                    const opts = optionsByQ[q.question_id] || [];
                    const enBodyText = q.body_json?.text || '';

                    // Translate body + all options in parallel
                    const [hiBody, ...hiOptTexts] = await Promise.all([
                        translateText(enBodyText),
                        ...opts.map(opt => translateText(opt.option_json?.text || '')),
                    ]);

                    const hiOpts = {};
                    opts.forEach((opt, idx) => { hiOpts[opt.option_key] = hiOptTexts[idx]; });
                    translationResults.set(q.question_id, { hiBody, hiOpts });
                } catch (e) {
                    errors.push(`Q ${q.question_id}: translate error: ${e.message}`);
                }
            }));
        }

        // 8. Now do all DB inserts/updates (fast, no network calls)
        for (const q of enQuestions) {
            const sectionId = q.exam_section_id;
            const opts = optionsByQ[q.question_id] || [];
            const tr = translationResults.get(q.question_id);
            if (!tr) continue; // translation failed, skip

            try {
                const enQuestionId = crypto.randomUUID();
                const enBodyText = q.body_json?.text || '';

                await client.query(
                    `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
                    [enQuestionId]
                );

                await client.query(`
                    INSERT INTO question_version
                    (question_id, version_no, language, status, paper_session_id, exam_section_id,
                     body_json, question_type, has_image, source_question_no, question_number_int,
                     meta_json, group_id, group_order, created_at, updated_at)
                    VALUES ($1, 1, 'EN', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                `, [
                    enQuestionId, q.status || 'MANUALLY_CORRECTED', enPsId, sectionId,
                    { text: enBodyText }, q.question_type || 'MCQ', q.has_image || false,
                    q.source_question_no, q.question_number_int,
                    { ...(q.meta_json || {}), source: 'split_translate', original_question_id: q.question_id },
                    q.group_id, q.group_order,
                ]);

                for (const opt of opts) {
                    await client.query(`
                        INSERT INTO question_option
                        (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                        VALUES ($1, 1, 'EN', $2, $3, $4, NOW())
                    `, [enQuestionId, opt.option_key, opt.option_json, opt.is_correct]);
                }

                // Update existing HI question with translated text
                await client.query(`
                    UPDATE question_version
                    SET body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text)),
                        language = 'HI', updated_at = NOW()
                    WHERE question_id = $2 AND version_no = $3
                `, [tr.hiBody, q.question_id, q.version_no]);

                for (const opt of opts) {
                    await client.query(`
                        UPDATE question_option
                        SET option_json = jsonb_set(option_json, '{text}', to_jsonb($1::text)),
                            language = 'HI'
                        WHERE question_id = $2 AND option_key = $3
                    `, [tr.hiOpts[opt.option_key] || '', q.question_id, opt.option_key]);
                }

                await client.query(`
                    INSERT INTO question_links
                    (english_question_id, english_version_no, english_language,
                     hindi_question_id, hindi_version_no, hindi_language,
                     paper_session_id_english, paper_session_id_hindi,
                     similarity_score, updated_score, status, created_at)
                    VALUES ($1, 1, 'EN', $2, $3, 'HI', $4, $5, 1.0, 1.0, 'MANUALLY_CORRECTED', NOW())
                `, [enQuestionId, q.question_id, q.version_no, enPsId, paper_session_id]);

                processed++;
            } catch (e) {
                errors.push(`Q ${q.question_id}: ${e.message}`);
            }
        }

        // 9. Copy English section questions to EN paper only (no translation, no HI pair)
        for (const q of englishSectionQuestions) {
            const opts = optionsByQ[q.question_id] || [];
            try {
                const enQuestionId = crypto.randomUUID();
                const enBodyText = q.body_json?.text || '';

                await client.query(
                    `INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`,
                    [enQuestionId]
                );

                await client.query(`
                    INSERT INTO question_version
                    (question_id, version_no, language, status, paper_session_id, exam_section_id,
                     body_json, question_type, has_image, source_question_no, question_number_int,
                     meta_json, group_id, group_order, created_at, updated_at)
                    VALUES ($1, 1, 'EN', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                `, [
                    enQuestionId, q.status || 'MANUALLY_CORRECTED', enPsId, ENGLISH_SECTION_ID,
                    { text: enBodyText }, q.question_type || 'MCQ', q.has_image || false,
                    q.source_question_no, q.question_number_int,
                    { ...(q.meta_json || {}), source: 'split_translate', original_question_id: q.question_id },
                    q.group_id, q.group_order,
                ]);

                for (const opt of opts) {
                    await client.query(`
                        INSERT INTO question_option
                        (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                        VALUES ($1, 1, 'EN', $2, $3, $4, NOW())
                    `, [enQuestionId, opt.option_key, opt.option_json, opt.is_correct]);
                }

                copiedEnglish++;
            } catch (e) {
                errors.push(`Q ${q.question_id} (English): ${e.message}`);
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
            total_questions: questions.length,
            bilingual_url: `/bilingual/${enPsId}`,
        });

    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('paper/split-translate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
