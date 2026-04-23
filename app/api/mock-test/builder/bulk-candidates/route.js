import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/mock-test/builder/bulk-candidates
 * Fetch multiple candidates at once based on blueprint slots.
 * Used by the "Load from Blueprint" button on the builder.
 *
 * Body: {
 *   mock_test_id,   — to exclude already-accepted questions
 *   target_exam_id, — excluded from candidate pool
 *   slots: [{ subtype, count, difficulty? }]  — what to fetch
 * }
 *
 * Returns: { results: [{ subtype, count_requested, questions: [...] }] }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { mock_test_id, target_exam_id, slots = [] } = body;
    if (!target_exam_id) {
        return NextResponse.json({ error: 'target_exam_id is required' }, { status: 400 });
    }
    if (!slots.length) {
        return NextResponse.json({ error: 'slots array is required and must not be empty' }, { status: 400 });
    }

    try {
        // Get all already-accepted question IDs for this mock test
        const acceptedRes = await db.query(`
            SELECT question_id FROM mock_test_question WHERE mock_test_id = $1
        `, [mock_test_id || '00000000-0000-0000-0000-000000000000']);
        const excludedIds = acceptedRes.rows.map(r => r.question_id);

        const results = [];

        for (const slot of slots) {
            const { subtype, count = 1, difficulty } = slot;
            if (count <= 0) continue;

            const params = [target_exam_id, excludedIds];
            let paramIdx = 3;
            const subtypeClause = subtype ? `AND qv.subtype = $${paramIdx++}` : '';
            if (subtype) params.push(subtype);
            const limitIdx = paramIdx++;
            params.push(Math.min(count, 50));
            const difficultyClause = difficulty ? `AND qv.difficulty = $${paramIdx++}` : '';
            if (difficulty) params.push(difficulty);

            const res = await db.query(`
                SELECT
                    qv.question_id,
                    qv.version_no,
                    qv.subtype,
                    qv.difficulty,
                    qv.has_image,
                    qv.correct_option_label,
                    qv.body_json->>'text'   AS question_text,
                    qv.source_question_no,
                    qv.solution_json,
                    ps.session_label        AS source_session,
                    ps.paper_date           AS source_date,
                    e.name                  AS source_exam,
                    e.code                  AS source_exam_code
                FROM question_version qv
                JOIN paper_session ps ON ps.paper_session_id = qv.paper_session_id
                JOIN exam e ON e.exam_id = ps.exam_id
                WHERE ps.exam_id != $1
                  AND qv.language = 'EN'
                  AND qv.status = 'MANUALLY_CORRECTED'
                  AND (qv.solution_status = 'DONE' OR qv.has_image = true)
                  AND ($2::uuid[] IS NULL OR qv.question_id != ALL($2::uuid[]))
                  ${subtypeClause}
                  ${difficultyClause}
                ORDER BY RANDOM()
                LIMIT $${limitIdx}
            `, params);

            // Fetch options for all returned questions
            const qIds = res.rows.map(r => r.question_id);
            let optsByQuestion = {};
            if (qIds.length > 0) {
                const optsRes = await db.query(`
                    SELECT question_id, option_key, option_json->>'text' AS text, is_correct
                    FROM question_option
                    WHERE question_id = ANY($1) AND language = 'EN'
                    ORDER BY option_key ASC
                `, [qIds]);
                for (const o of optsRes.rows) {
                    if (!optsByQuestion[o.question_id]) optsByQuestion[o.question_id] = [];
                    optsByQuestion[o.question_id].push(o);
                }
            }

            const questions = res.rows.map(q => ({
                ...q,
                options: optsByQuestion[q.question_id] || [],
            }));

            results.push({ subtype, count_requested: count, questions });

            // Add these IDs to excluded so subsequent slots don't overlap
            excludedIds.push(...qIds);
        }

        return NextResponse.json({ results });

    } catch (e) {
        console.error('mock-test/builder/bulk-candidates error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
