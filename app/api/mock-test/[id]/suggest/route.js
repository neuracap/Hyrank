import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mock-test/[id]/suggest
 * Get replacement suggestions for a rejected question slot.
 * Body: { question_id }
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { question_id } = await req.json();

    if (!question_id) {
        return NextResponse.json({ error: 'question_id is required' }, { status: 400 });
    }

    try {
        // 1. Get the slot info for the rejected question
        // Get the target exam_id from mock_test
        const mockRes = await db.query(`SELECT exam_id FROM mock_test WHERE mock_test_id = $1`, [id]);
        if (mockRes.rows.length === 0) {
            return NextResponse.json({ error: 'Mock test not found' }, { status: 404 });
        }
        const targetExamId = mockRes.rows[0].exam_id;

        const slotRes = await db.query(`
            SELECT mtq.exam_section_id, mtq.slot_subtype, mtq.slot_difficulty, mtq.group_id,
                   es.code AS section_code
            FROM mock_test_question mtq
            JOIN exam_section es ON es.section_id = mtq.exam_section_id
            WHERE mtq.mock_test_id = $1 AND mtq.question_id = $2
        `, [id, question_id]);

        if (slotRes.rows.length === 0) {
            return NextResponse.json({ error: 'Question not found in this mock' }, { status: 404 });
        }

        const slot = slotRes.rows[0];

        // 2. Get all question_ids already in this mock (to exclude)
        const existingRes = await db.query(`
            SELECT question_id FROM mock_test_question WHERE mock_test_id = $1
        `, [id]);
        const excludeIds = new Set(existingRes.rows.map(r => r.question_id));

        // 3. Get question_ids already used for this exam (across all test types)
        const usedRes = await db.query(`
            SELECT DISTINCT question_id FROM question_usage WHERE exam_id = $1
        `, [targetExamId]);
        for (const r of usedRes.rows) excludeIds.add(r.question_id);

        // Also exclude from other draft/in-review mocks for same exam
        const draftUsedRes = await db.query(`
            SELECT DISTINCT mtq.question_id
            FROM mock_test_question mtq
            JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
            WHERE mt.exam_id = $1 AND mt.status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')
              AND mt.mock_test_id != $2
        `, [targetExamId, id]);
        for (const r of draftUsedRes.rows) excludeIds.add(r.question_id);

        // 4. Find equivalent sections across exams
        const equivRes = await db.query(`
            SELECT section_id, exam_id FROM exam_section WHERE UPPER(code) = UPPER($1)
        `, [slot.section_code]);
        const allSectionIds = equivRes.rows.map(r => r.section_id);

        // 5. Find candidates matching the slot
        const candidatesRes = await db.query(`
            SELECT
                qv.question_id, qv.subtype, qv.difficulty,
                qv.correct_option_label, qv.source_question_no,
                qv.body_json->>'text' AS question_text,
                qv.paper_session_id,
                es.exam_id AS source_exam_id,
                e_src.name AS source_exam_name,
                ps.session_name AS source_session_name
            FROM question_version qv
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            LEFT JOIN exam e_src ON e_src.exam_id = es.exam_id
            LEFT JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
            WHERE qv.exam_section_id = ANY($1)
              AND qv.language = 'EN'
              AND qv.solution_status = 'DONE'
              AND qv.subtype IS NOT NULL
              AND qv.difficulty IS NOT NULL
              AND qv.correct_option_label IS NOT NULL
              AND qv.correct_option_label != ''
              AND (es.exam_id != $2 OR qv.paper_session_id IS NULL)
              AND qv.question_id != ALL($3)
              AND EXISTS (
                  SELECT 1 FROM question_links ql
                  WHERE ql.english_question_id = qv.question_id
                     OR ql.hindi_question_id = qv.question_id
              )
            ORDER BY
                CASE WHEN qv.subtype = $4 THEN 0 ELSE 1 END,
                CASE WHEN qv.difficulty = $5 THEN 0 ELSE 1 END,
                RANDOM()
            LIMIT 10
        `, [
            allSectionIds,
            targetExamId,
            Array.from(excludeIds),
            slot.slot_subtype,
            slot.slot_difficulty === 'easy' ? 1 : slot.slot_difficulty === 'hard' ? 3 : 2,
        ]);

        // 6. Fetch options for suggestions
        const sugIds = candidatesRes.rows.map(c => c.question_id);
        let optionsByQ = {};
        if (sugIds.length > 0) {
            const optRes = await db.query(`
                SELECT question_id, option_key AS opt_label,
                       option_json->>'text' AS opt_text
                FROM question_option
                WHERE question_id = ANY($1) AND language = 'EN'
                ORDER BY option_key
            `, [sugIds]);
            for (const o of optRes.rows) {
                if (!optionsByQ[o.question_id]) optionsByQ[o.question_id] = [];
                optionsByQ[o.question_id].push(o);
            }
        }

        const suggestions = candidatesRes.rows.map(c => {
            let sourceLabel;
            if (c.paper_session_id) {
                sourceLabel = `PYQ — ${c.source_exam_name || 'Unknown'}`;
                if (c.source_session_name) sourceLabel += ` (${c.source_session_name})`;
            } else {
                sourceLabel = 'LLM / Manual';
            }
            return {
                ...c,
                options: optionsByQ[c.question_id] || [],
                source_type: c.paper_session_id ? 'pyq' : 'generated',
                source_label: sourceLabel,
            };
        });

        return NextResponse.json({
            success: true,
            slot: { subtype: slot.slot_subtype, difficulty: slot.slot_difficulty },
            suggestions,
        });

    } catch (e) {
        console.error('mock-test/suggest error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
