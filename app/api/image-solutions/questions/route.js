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

        const questionsRes = await client.query(`
            SELECT
                qv.question_id,
                qv.version_no,
                qv.language,
                qv.source_question_no AS source_q_no,
                qv.body_json->>'text' AS question_text,
                qv.has_image,
                qv.difficulty,
                qv.solution_json,
                qv.solution_json->>'answer_label' AS answer_label,
                qv.correct_option_label,
                qv.status,
                qv.solution_status,
                es.code AS section_code
            FROM question_version qv
            LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE qv.paper_session_id = $1
              AND qv.language = 'EN'
              AND qv.has_image = true
              AND qv.status IN ('MANUALLY_CORRECTED', 'FLAGGED')
            ORDER BY qv.source_question_no ASC NULLS LAST
        `, [paperId]);

        const questions = questionsRes.rows;
        if (questions.length === 0) {
            return NextResponse.json({ questions: [] });
        }

        // Derive answer_label from correct_option_label or solution_json
        for (const q of questions) {
            if (!q.answer_label && q.correct_option_label) {
                q.answer_label = q.correct_option_label;
            }
            // Parse solution_json if it's a string
            if (typeof q.solution_json === 'string') {
                try { q.solution_json = JSON.parse(q.solution_json); } catch { q.solution_json = null; }
            }
        }

        const questionIds = questions.map(q => q.question_id);

        // Fetch options
        const optionsRes = await client.query(`
            SELECT
                question_id,
                option_key AS opt_label,
                option_json->>'text' AS opt_text,
                is_correct
            FROM question_option
            WHERE question_id = ANY($1)
              AND language = 'EN'
            ORDER BY option_key ASC
        `, [questionIds]);

        const optionsByQuestion = {};
        for (const opt of optionsRes.rows) {
            if (!optionsByQuestion[opt.question_id]) {
                optionsByQuestion[opt.question_id] = [];
            }
            optionsByQuestion[opt.question_id].push(opt);
        }

        // Fetch image assets
        const assetsRes = await client.query(`
            SELECT
                qam.question_id,
                qam.role,
                qam.option_key,
                a.local_path,
                a.original_name
            FROM question_asset_map qam
            JOIN asset a ON a.asset_id = qam.asset_id
            WHERE qam.question_id = ANY($1)
            ORDER BY qam.role, qam.option_key
        `, [questionIds]);

        const assetsByQuestion = {};
        for (const asset of assetsRes.rows) {
            const filename = asset.original_name
                || (asset.local_path ? asset.local_path.split(/[/\\]/).pop() : null);
            asset.image_url = filename
                ? `/api/assets?name=${encodeURIComponent(filename)}`
                : null;
            if (!assetsByQuestion[asset.question_id]) {
                assetsByQuestion[asset.question_id] = [];
            }
            assetsByQuestion[asset.question_id].push(asset);
        }

        // Fetch source PDF path for this paper
        const docRes = await client.query(`
            SELECT j.source_pdf_path
            FROM paper_session ps
            LEFT JOIN raw_mmd_doc d ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
            LEFT JOIN import_job j ON d.import_job_id = j.import_job_id
            WHERE ps.paper_session_id = $1
        `, [paperId]);
        const source_pdf_path = docRes.rows[0]?.source_pdf_path || null;

        const questionsWithData = questions.map(q => ({
            ...q,
            options: optionsByQuestion[q.question_id] || [],
            assets: assetsByQuestion[q.question_id] || [],
        }));

        return NextResponse.json({ questions: questionsWithData, source_pdf_path });

    } catch (error) {
        console.error('image-solutions/questions error:', error);
        return NextResponse.json({ error: 'Failed to load questions', details: error.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
