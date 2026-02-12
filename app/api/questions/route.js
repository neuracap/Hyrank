import db from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    try {
        // Fetch questions from question_version (joining to get exam info)
        // We filter by language='EN' by default for this view, or we could make it a param.
        const questionsRes = await db.query(`
            SELECT 
                qv.question_id as id, 
                qv.source_question_no as q_no, 
                e.name as exam, 
                qv.body_json->>'text' as question_text, 
                qv.difficulty, 
                ps.subject, 
                qv.meta_json->>'section_name' as topic, 
                qv.solution_json->>'answer_label' as final_answer_label 
            FROM question_version qv
            LEFT JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
            LEFT JOIN exam e ON ps.exam_id = e.exam_id
            WHERE qv.language = 'EN'
            ORDER BY qv.created_at ASC 
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        const questions = questionsRes.rows;

        const countRes = await db.query("SELECT COUNT(*) as total FROM question_version WHERE language = 'EN'");
        const total = parseInt(countRes.rows[0].total);

        return NextResponse.json({
            data: questions,
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Database error:', error);
        return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 });
    }
}
