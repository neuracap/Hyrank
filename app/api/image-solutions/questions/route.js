import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const paperId = searchParams.get('paperId');
    const examName = searchParams.get('exam');
    const sectionCode = searchParams.get('section');
    const solvedFilter = searchParams.get('solved') || 'all';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = (page - 1) * limit;

    let client;
    try {
        client = await db.connect();

        // Build dynamic WHERE — exclude NOT_REVIEWED papers
        const conditions = [
            `qv.language = 'EN'`,
            `qv.has_image = true`,
            `qv.status IN ('MANUALLY_CORRECTED', 'FLAGGED')`,
            `ps.status != 'NOT_REVIEWED'`,
        ];
        const params = [];
        let paramIdx = 1;

        if (paperId) {
            conditions.push(`qv.paper_session_id = $${paramIdx}`);
            params.push(paperId);
            paramIdx++;
        }

        if (examName && examName !== 'ALL') {
            conditions.push(`e.name = $${paramIdx}`);
            params.push(examName);
            paramIdx++;
        }

        if (sectionCode && sectionCode !== 'ALL') {
            conditions.push(`es.code = $${paramIdx}`);
            params.push(sectionCode);
            paramIdx++;
        }

        if (solvedFilter === 'solved') {
            conditions.push(`qv.solution_status = 'DONE'`);
        } else if (solvedFilter === 'unsolved') {
            conditions.push(`(qv.solution_status IS NULL OR qv.solution_status != 'DONE')`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Count total
        const countRes = await client.query(`
            SELECT COUNT(*) AS c
            FROM question_version qv
            LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
            ${whereClause}
        `, params);
        const total = parseInt(countRes.rows[0].c);

        // Fetch questions
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
                qv.subtype,
                es.code AS section_code,
                ps.session_label,
                e.name AS exam_name
            FROM question_version qv
            LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
            LEFT JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            LEFT JOIN exam e ON e.exam_id = ps.exam_id
            ${whereClause}
            ORDER BY e.name ASC NULLS LAST, ps.session_label ASC, qv.question_number_int ASC NULLS LAST
            LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `, [...params, limit, offset]);

        const questions = questionsRes.rows;

        // Derive answer_label
        for (const q of questions) {
            if (!q.answer_label && q.correct_option_label) {
                q.answer_label = q.correct_option_label;
            }
            if (typeof q.solution_json === 'string') {
                try { q.solution_json = JSON.parse(q.solution_json); } catch { q.solution_json = null; }
            }
        }

        if (questions.length === 0) {
            return NextResponse.json({ questions: [], total, totalPages: 0, source_pdf_path: null });
        }

        const questionIds = questions.map(q => q.question_id);

        // Fetch options
        const optionsRes = await client.query(`
            SELECT question_id, option_key AS opt_label,
                   option_json->>'text' AS opt_text, is_correct
            FROM question_option
            WHERE question_id = ANY($1) AND language = 'EN'
            ORDER BY option_key ASC
        `, [questionIds]);

        const optionsByQuestion = {};
        for (const opt of optionsRes.rows) {
            if (!optionsByQuestion[opt.question_id]) optionsByQuestion[opt.question_id] = [];
            optionsByQuestion[opt.question_id].push(opt);
        }

        // Fetch image assets
        const assetsRes = await client.query(`
            SELECT qam.question_id, qam.role, qam.option_key,
                   a.local_path, a.original_name
            FROM question_asset_map qam
            JOIN asset a ON a.asset_id = qam.asset_id
            WHERE qam.question_id = ANY($1)
            ORDER BY qam.role, qam.option_key
        `, [questionIds]);

        const assetsByQuestion = {};
        for (const asset of assetsRes.rows) {
            const filename = asset.local_path
                ? asset.local_path.split(/[/\\]/).pop()
                : asset.original_name;
            asset.image_url = filename
                ? `/api/assets?name=${encodeURIComponent(filename)}`
                : null;
            if (!assetsByQuestion[asset.question_id]) assetsByQuestion[asset.question_id] = [];
            assetsByQuestion[asset.question_id].push(asset);
        }

        // Source PDF (only if single paper)
        let source_pdf_path = null;
        if (paperId) {
            const docRes = await client.query(`
                SELECT j.source_pdf_path
                FROM paper_session ps
                LEFT JOIN raw_mmd_doc d ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
                LEFT JOIN import_job j ON d.import_job_id = j.import_job_id
                WHERE ps.paper_session_id = $1
            `, [paperId]);
            source_pdf_path = docRes.rows[0]?.source_pdf_path || null;
        }

        const questionsWithData = questions.map(q => ({
            ...q,
            options: optionsByQuestion[q.question_id] || [],
            assets: assetsByQuestion[q.question_id] || [],
        }));

        return NextResponse.json({
            questions: questionsWithData,
            total,
            totalPages: Math.ceil(total / limit),
            source_pdf_path,
        });

    } catch (error) {
        console.error('image-solutions/questions error:', error);
        return NextResponse.json({ error: 'Failed to load questions', details: error.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
