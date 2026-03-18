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

        // Fetch EN questions that have images and need solutions
        const questionsRes = await client.query(`
            SELECT
                qv.question_id,
                qv.version_no,
                qv.source_question_no AS source_q_no,
                qv.body_json->>'text' AS question_text,
                qv.has_image,
                qv.difficulty,
                qv.solution_json->>'answer_label' AS answer_label,
                qv.solution_json->>'solution_text' AS solution_text,
                qv.solution_json->>'tags' AS tags
            FROM question_version qv
            WHERE qv.paper_session_id = $1
              AND qv.language = 'EN'
              AND qv.has_image = true
            ORDER BY qv.source_question_no ASC NULLS LAST
        `, [paperId]);

        const questions = questionsRes.rows;
        if (questions.length === 0) {
            return NextResponse.json({ questions: [] });
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
                a.local_path AS image_url
            FROM question_asset_map qam
            JOIN asset a ON a.asset_id = qam.asset_id
            WHERE qam.question_id = ANY($1)
            ORDER BY qam.role, qam.option_key
        `, [questionIds]);

        const assetsByQuestion = {};
        for (const asset of assetsRes.rows) {
            if (!assetsByQuestion[asset.question_id]) {
                assetsByQuestion[asset.question_id] = [];
            }
            assetsByQuestion[asset.question_id].push(asset);
        }

        const questionsWithData = questions.map(q => ({
            ...q,
            options: optionsByQuestion[q.question_id] || [],
            assets: assetsByQuestion[q.question_id] || [],
        }));

        return NextResponse.json({ questions: questionsWithData });

    } catch (error) {
        console.error('image-solutions/questions error:', error);
        return NextResponse.json({ error: 'Failed to load questions', details: error.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
