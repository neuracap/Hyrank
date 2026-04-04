import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/social/search-questions?exam=SSC CGL&section=QA&limit=20&random=true
 * Search for solved questions to use in social media posts.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const exam = searchParams.get('exam');
    const section = searchParams.get('section');
    const difficulty = searchParams.get('difficulty');
    const random = searchParams.get('random') === 'true';
    const limit = parseInt(searchParams.get('limit') || '20');
    const questionId = searchParams.get('id');

    try {
        const conditions = [
            `qv.language = 'EN'`,
            `qv.solution_status = 'DONE'`,
            `qv.correct_option_label IS NOT NULL`,
        ];
        const params = [];
        let paramIdx = 1;

        if (questionId) {
            conditions.push(`qv.question_id = $${paramIdx}`);
            params.push(questionId);
            paramIdx++;
        }
        if (exam) {
            conditions.push(`e.name = $${paramIdx}`);
            params.push(exam);
            paramIdx++;
        }
        if (section) {
            conditions.push(`es.code = $${paramIdx}`);
            params.push(section);
            paramIdx++;
        }
        if (difficulty) {
            conditions.push(`qv.difficulty = $${paramIdx}`);
            params.push(parseInt(difficulty));
            paramIdx++;
        }

        const orderBy = random ? 'ORDER BY RANDOM()' : 'ORDER BY qv.created_at DESC';

        const res = await db.query(`
            SELECT
                qv.question_id, qv.body_json->>'text' AS question_text,
                qv.correct_option_label, qv.difficulty, qv.subtype,
                qv.solution_json, qv.source_question_no,
                es.code AS section_code, e.name AS exam_name
            FROM question_version qv
            LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
            LEFT JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            LEFT JOIN exam e ON e.exam_id = ps.exam_id
            WHERE ${conditions.join(' AND ')}
            ${orderBy}
            LIMIT $${paramIdx}
        `, [...params, limit]);

        // Fetch options
        const qIds = res.rows.map(r => r.question_id);
        let optionsMap = {};
        if (qIds.length > 0) {
            const optRes = await db.query(`
                SELECT question_id, option_key, option_json->>'text' AS opt_text
                FROM question_option
                WHERE question_id = ANY($1) AND language = 'EN'
                ORDER BY option_key
            `, [qIds]);
            for (const o of optRes.rows) {
                if (!optionsMap[o.question_id]) optionsMap[o.question_id] = [];
                optionsMap[o.question_id].push(o);
            }
        }

        const questions = res.rows.map(q => ({
            ...q,
            options: optionsMap[q.question_id] || [],
        }));

        return NextResponse.json({ questions });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
