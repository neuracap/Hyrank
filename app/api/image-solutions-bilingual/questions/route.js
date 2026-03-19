import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export async function GET(request) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const paperId = searchParams.get('paperId');
    if (!paperId) {
        return NextResponse.json({ error: 'paperId is required' }, { status: 400 });
    }

    let client;
    try {
        client = await db.connect();

        // Fetch linked bilingual pairs where EN side has images
        const pairsRes = await client.query(`
            SELECT
                ql.id AS link_id,
                ql.status AS link_status,
                ql.similarity_score,
                -- English
                qe.question_id AS eng_id,
                qe.version_no AS eng_version,
                qe.body_json->>'text' AS eng_text,
                qe.has_image AS eng_has_image,
                qe.source_question_no AS eng_source_no,
                qe.difficulty,
                qe.solution_json AS eng_solution_json,
                qe.correct_option_label,
                qe.solution_status,
                qe.subtype,
                es.code AS section_code,
                -- Hindi
                qh.question_id AS hin_id,
                qh.version_no AS hin_version,
                qh.body_json->>'text' AS hin_text,
                qh.has_image AS hin_has_image,
                qh.source_question_no AS hin_source_no,
                qh.solution_json AS hin_solution_json
            FROM question_links ql
            INNER JOIN question_version qe
                ON ql.english_question_id = qe.question_id
                AND ql.english_version_no = qe.version_no
                AND qe.language = 'EN'
            LEFT JOIN question_version qh
                ON ql.hindi_question_id = qh.question_id
                AND ql.hindi_version_no = qh.version_no
                AND qh.language = 'HI'
            LEFT JOIN exam_section es ON es.section_id = qe.exam_section_id
            WHERE qe.paper_session_id = $1
              AND qe.status IN ('MANUALLY_CORRECTED', 'FLAGGED')
              AND (qe.has_image = true OR qh.has_image = true)
            ORDER BY
                CAST(NULLIF(regexp_replace(qe.source_question_no, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST,
                qe.question_id ASC
        `, [paperId]);

        const pairs = pairsRes.rows;
        if (pairs.length === 0) {
            return NextResponse.json({ pairs: [], source_pdf_path: null });
        }

        // Parse solution_json strings
        for (const p of pairs) {
            if (typeof p.eng_solution_json === 'string') {
                try { p.eng_solution_json = JSON.parse(p.eng_solution_json); } catch { p.eng_solution_json = null; }
            }
            if (typeof p.hin_solution_json === 'string') {
                try { p.hin_solution_json = JSON.parse(p.hin_solution_json); } catch { p.hin_solution_json = null; }
            }
        }

        // Collect all question IDs (EN + HI)
        const allIds = [];
        for (const p of pairs) {
            allIds.push(p.eng_id);
            if (p.hin_id) allIds.push(p.hin_id);
        }

        // Fetch options for all questions (both languages)
        const optionsRes = await client.query(`
            SELECT
                question_id,
                language,
                option_key AS opt_label,
                option_json->>'text' AS opt_text,
                is_correct
            FROM question_option
            WHERE question_id = ANY($1)
            ORDER BY option_key ASC
        `, [allIds]);

        const optionsMap = {};
        for (const opt of optionsRes.rows) {
            const key = `${opt.question_id}_${opt.language}`;
            if (!optionsMap[key]) optionsMap[key] = [];
            optionsMap[key].push(opt);
        }

        // Fetch image assets
        const assetsRes = await client.query(`
            SELECT
                qam.question_id,
                qam.role,
                qam.option_key,
                a.local_path AS image_url
            FROM question_asset_map qam
            JOIN asset a ON a.asset_id = qam.asset_id
            WHERE qam.question_id = ANY($1)
            ORDER BY qam.role, qam.option_key
        `, [allIds]);

        const assetsMap = {};
        for (const asset of assetsRes.rows) {
            if (!assetsMap[asset.question_id]) assetsMap[asset.question_id] = [];
            assetsMap[asset.question_id].push(asset);
        }

        // Fetch source PDF path
        const docRes = await client.query(`
            SELECT j.source_pdf_path
            FROM paper_session ps
            LEFT JOIN raw_mmd_doc d ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
            LEFT JOIN import_job j ON d.import_job_id = j.import_job_id
            WHERE ps.paper_session_id = $1
        `, [paperId]);
        const source_pdf_path = docRes.rows[0]?.source_pdf_path || null;

        // Enrich pairs
        const enriched = pairs.map(p => ({
            ...p,
            eng_options: optionsMap[`${p.eng_id}_EN`] || [],
            hin_options: optionsMap[`${p.hin_id}_HI`] || [],
            eng_assets: assetsMap[p.eng_id] || [],
            hin_assets: assetsMap[p.hin_id] || [],
        }));

        return NextResponse.json({ pairs: enriched, source_pdf_path });

    } catch (error) {
        console.error('image-solutions-bilingual/questions error:', error);
        return NextResponse.json({ error: 'Failed to load questions', details: error.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
