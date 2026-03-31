import db from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request, { params }) {
    const { id } = await params;

    try {
        const questionRes = await db.query(`
            SELECT 
                qv.question_id,
                qv.source_question_no as q_no, 
                e.name as exam, 
                qv.body_json->>'text' as question_text, 
                qv.difficulty, 
                ps.subject, 
                qv.meta_json->>'section_name' as topic, 
                qv.solution_json->>'answer_label' as final_answer_label,
                qv.status as review_status,
                qv.version_no
            FROM question_version qv
            LEFT JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            WHERE qv.question_id = $1
            LIMIT 1
        `, [id]);

        const question = questionRes.rows[0];

        if (!question) {
            return NextResponse.json({ error: 'Question not found' }, { status: 404 });
        }

        // Map fields to match what frontend expects (if needed) or keep as is.
        // Frontend likely expects 'id', 'question_text', etc.
        question.id = question.question_id; // Alias

        const optionsRes = await db.query(`
            SELECT 
                option_key as opt_label, 
                option_json->>'text' as opt_text,
                question_id,
                option_key as id -- Frontend might need a unique key
            FROM question_option 
            WHERE question_id = $1 
            ORDER BY option_key ASC
        `, [id]);
        const options = optionsRes.rows;

        const llmSolutions = []; // Table does not exist anymore

        return NextResponse.json({
            question,
            options,
            llmSolutions
        });
    } catch (error) {
        console.error('Database error:', error);
        return NextResponse.json({ error: 'Failed to fetch question details' }, { status: 500 });
    }
}

export async function PUT(request, { params }) {
    const { id } = await params;
    const body = await request.json();

    const {
        question_text,
        review_status,
        options,
        // Helper to extract version if passed, else default to latest logic (omitted for brevity)
    } = body;

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        // Update question_version
        // Note: This updates the latest version found or specific logic needed? 
        // For now, updating all versions or just the one matching ID? 
        // Usually we update specific version. Assuming version_no=1 or passed.
        // Simplified: Update all versions for this question_id for text? Or just latest?
        // Let's assume updating the text updates the current version.

        const hasImage = /\\includegraphics|!\[.*?\]\(/.test(question_text || '');
        await client.query(`
            UPDATE question_version
            SET
                body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text)),
                status = $2,
                has_image = $4,
                updated_at = NOW()
            WHERE question_id = $3
        `, [question_text, review_status, id, hasImage]);

        if (options && Array.isArray(options)) {
            const updateOptionQuery = `
                UPDATE question_option 
                SET option_json = jsonb_set(option_json, '{text}', to_jsonb($1::text)) 
                WHERE question_id = $2 AND option_key = $3
            `;
            for (const opt of options) {
                if (opt.opt_label) {
                    await client.query(updateOptionQuery, [opt.opt_text, id, opt.opt_label]);
                }
            }
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Database error:', error);
        return NextResponse.json({ error: 'Failed to update question: ' + error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
