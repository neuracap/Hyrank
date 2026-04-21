import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mock-test/[id]
 * Full mock test detail with all questions, options, source info.
 */
export async function GET(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    try {
        // 1. Get mock test info
        const mockRes = await db.query(`
            SELECT mt.*, e.name AS exam_name, mb.name AS blueprint_name
            FROM mock_test mt
            LEFT JOIN exam e ON e.exam_id = mt.exam_id
            LEFT JOIN mock_blueprint mb ON mb.blueprint_id = mt.blueprint_id
            WHERE mt.mock_test_id = $1
        `, [id]);

        if (mockRes.rows.length === 0) {
            return NextResponse.json({ error: 'Mock test not found' }, { status: 404 });
        }
        const mock = mockRes.rows[0];

        // 2. Get all questions with source info
        const questionsRes = await db.query(`
            SELECT
                mtq.question_id, mtq.exam_section_id, mtq.position,
                mtq.slot_subtype, mtq.slot_difficulty,
                mtq.review_status, mtq.reviewed_by, mtq.reviewed_at,
                mtq.rejection_note, mtq.group_id, mtq.score,
                qv.body_json->>'text' AS question_text,
                qv.subtype, qv.difficulty, qv.correct_option_label,
                qv.final_answer_text, qv.source_question_no,
                qv.paper_session_id, qv.solution_status,
                qv.solution_json,
                es_q.code AS question_section_code,
                es_q.exam_id AS source_exam_id,
                e_src.name AS source_exam_name,
                ps.session_label AS source_session_name,
                es_slot.code AS slot_section_code,
                es_slot.name AS slot_section_name
            FROM mock_test_question mtq
            JOIN question_version qv ON qv.question_id = mtq.question_id
                AND qv.language = 'EN' AND qv.version_no = 1
            LEFT JOIN exam_section es_q ON es_q.section_id = qv.exam_section_id
            LEFT JOIN exam e_src ON e_src.exam_id = es_q.exam_id
            LEFT JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            LEFT JOIN exam_section es_slot ON es_slot.section_id = mtq.exam_section_id
            WHERE mtq.mock_test_id = $1
            ORDER BY es_slot.sort_order ASC NULLS LAST, mtq.position ASC
        `, [id]);

        // 3. Fetch options for all questions
        const questionIds = questionsRes.rows.map(q => q.question_id);
        let optionsByQuestion = {};

        if (questionIds.length > 0) {
            const optRes = await db.query(`
                SELECT question_id, option_key AS opt_label,
                       option_json->>'text' AS opt_text, is_correct
                FROM question_option
                WHERE question_id = ANY($1) AND language = 'EN'
                ORDER BY option_key ASC
            `, [questionIds]);

            for (const opt of optRes.rows) {
                if (!optionsByQuestion[opt.question_id]) optionsByQuestion[opt.question_id] = [];
                optionsByQuestion[opt.question_id].push(opt);
            }
        }

        // 4. Assemble questions with source derivation
        const questions = questionsRes.rows.map(q => {
            let sourceLabel;
            if (q.paper_session_id) {
                sourceLabel = `PYQ — ${q.source_exam_name || 'Unknown Exam'}`;
                if (q.source_session_name) sourceLabel += ` (${q.source_session_name})`;
            } else {
                sourceLabel = 'LLM / Manual';
            }

            return {
                ...q,
                options: optionsByQuestion[q.question_id] || [],
                source_type: q.paper_session_id ? 'pyq' : 'generated',
                source_label: sourceLabel,
            };
        });

        // 5. Group by section for easier consumption
        const sections = {};
        for (const q of questions) {
            const secKey = q.exam_section_id;
            if (!sections[secKey]) {
                sections[secKey] = {
                    exam_section_id: q.exam_section_id,
                    code: q.slot_section_code,
                    name: q.slot_section_name,
                    questions: [],
                };
            }
            sections[secKey].questions.push(q);
        }

        return NextResponse.json({
            mock,
            sections: Object.values(sections),
            total_questions: questions.length,
            review_summary: {
                approved: questions.filter(q => q.review_status === 'APPROVED').length,
                rejected: questions.filter(q => q.review_status === 'REJECTED').length,
                pending: questions.filter(q => q.review_status === 'PENDING').length,
            },
        });
    } catch (e) {
        console.error('mock-test/[id] error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
