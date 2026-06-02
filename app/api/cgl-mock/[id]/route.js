import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { SECTION_CODES, TARGET_SECTION_IDS, BANK_SECTION_IDS, CGL_T1_EXAM_ID } from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';

const SECTION_BY_TARGET_ID = Object.fromEntries(
    SECTION_CODES.map(c => [TARGET_SECTION_IDS[c], c])
);
const SECTION_BY_BANK_ID = Object.fromEntries(
    SECTION_CODES.map(c => [BANK_SECTION_IDS[c], c])
);

/**
 * GET /api/cgl-mock/[id]
 * Full lineup of a CGL T1 mock: mock metadata, sections, questions with
 * stem/options/answer/difficulty/subtype/variation/group info, and placeholders
 * inlined at their positions.
 */
export async function GET(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;

    const client = await db.connect();
    try {
        const mtRes = await client.query(`
            SELECT mock_test_id, exam_id, name, slug, status, type, stats_json,
                   created_by, created_at, updated_at, published_at
            FROM mock_test
            WHERE mock_test_id = $1
        `, [id]);
        if (mtRes.rows.length === 0) {
            return NextResponse.json({ error: 'Mock not found' }, { status: 404 });
        }
        const mock = mtRes.rows[0];

        const qRes = await client.query(`
            SELECT mtq.position, mtq.slot_subtype, mtq.slot_difficulty,
                   mtq.exam_section_id, mtq.group_id, mtq.review_status,
                   qv.question_id, qv.subtype, qv.difficulty,
                   qv.leaf_topic_id, qv.correct_option_label,
                   qv.body_json, qv.solution_status, qv.solution_json,
                   (qv.meta_json->>'variation') AS variation,
                   (qv.meta_json->>'source_file') AS source_file
            FROM mock_test_question mtq
            JOIN question_version qv
              ON qv.question_id = mtq.question_id
             AND qv.language = 'EN'
            WHERE mtq.mock_test_id = $1
            ORDER BY mtq.exam_section_id, mtq.position
        `, [id]);

        const qids = qRes.rows.map(r => r.question_id);
        let optsByQid = {};
        if (qids.length > 0) {
            const optRes = await client.query(`
                SELECT question_id, option_key, option_json
                FROM question_option
                WHERE question_id = ANY($1) AND language = 'EN'
                ORDER BY question_id, option_key
            `, [qids]);
            for (const row of optRes.rows) {
                if (!optsByQid[row.question_id]) optsByQid[row.question_id] = {};
                optsByQid[row.question_id][row.option_key] = row.option_json;
            }
        }

        // Group stimuli (passages) for any grouped question.
        const groupIds = [...new Set(qRes.rows.map(r => r.group_id).filter(Boolean))];
        let stimuliByGroup = {};
        if (groupIds.length > 0) {
            const passRes = await client.query(`
                SELECT qg.group_id, qg.group_type, qg.passage_question_id,
                       pv.body_json AS passage_body
                FROM question_group qg
                LEFT JOIN question_version pv
                  ON pv.question_id = qg.passage_question_id
                 AND pv.language = 'EN'
                WHERE qg.group_id = ANY($1)
            `, [groupIds]);
            for (const row of passRes.rows) {
                stimuliByGroup[row.group_id] = {
                    group_type: row.group_type,
                    passage_question_id: row.passage_question_id,
                    passage_body: row.passage_body,
                };
            }
        }

        // Assemble per-section lineup with placeholders inlined by position.
        const stats = mock.stats_json || {};
        const placeholders = Array.isArray(stats.placeholders) ? stats.placeholders : [];

        const bySection = {};
        for (const code of SECTION_CODES) bySection[code] = [];
        for (const r of qRes.rows) {
            const code = SECTION_BY_TARGET_ID[r.exam_section_id] || 'UNKNOWN';
            const stimulus = r.group_id ? (stimuliByGroup[r.group_id] || null) : null;
            bySection[code]?.push({
                kind: 'question',
                position: r.position,
                slot_subtype: r.slot_subtype,
                slot_difficulty: r.slot_difficulty,
                review_status: r.review_status,
                question_id: r.question_id,
                subtype: r.subtype,
                difficulty: r.difficulty,
                variation: r.variation,
                leaf_topic_id: r.leaf_topic_id,
                correct_option_label: r.correct_option_label,
                body_json: r.body_json,
                solution_json: r.solution_json,
                solution_status: r.solution_status,
                options: optsByQid[r.question_id] || {},
                group_id: r.group_id,
                stimulus: stimulus,
            });
        }
        for (const p of placeholders) {
            if (!bySection[p.section_code]) continue;
            bySection[p.section_code].push({
                kind: 'placeholder',
                position: p.position,
                placeholder_id: p.placeholder_id,
            });
        }
        for (const code of SECTION_CODES) {
            bySection[code].sort((a, b) => (a.position || 0) - (b.position || 0));
        }

        // Per-section verified bank pool, excluding anything already in any
        // CGL T1 mock — used by the analysis panel to show uncovered subtypes.
        const bankSectionIds = SECTION_CODES.map(c => BANK_SECTION_IDS[c]);
        const poolRes = await client.query(`
            SELECT qv.exam_section_id, qv.subtype, COUNT(*)::int AS pool
            FROM question_version qv
            WHERE qv.source_type = 'bank'
              AND qv.question_type = 'MCQ'
              AND qv.language = 'EN'
              AND qv.solution_status = 'DONE'
              AND qv.correct_option_label IS NOT NULL
              AND COALESCE(qv.status, '') != 'JUNK'
              AND COALESCE((qv.meta_json->'resolve'->>'match')::boolean, true) = true
              AND qv.exam_section_id = ANY($1)
              AND qv.difficulty IN (2, 3)
              AND NOT EXISTS (
                  SELECT 1 FROM mock_test_question mtq
                  JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
                  WHERE mtq.question_id = qv.question_id AND mt.exam_id = $2
              )
            GROUP BY qv.exam_section_id, qv.subtype
            ORDER BY qv.exam_section_id, COUNT(*) DESC
        `, [bankSectionIds, CGL_T1_EXAM_ID]);
        const poolBySection = {};
        for (const code of SECTION_CODES) poolBySection[code] = [];
        for (const row of poolRes.rows) {
            const code = SECTION_BY_BANK_ID[row.exam_section_id];
            if (code) poolBySection[code].push({ subtype: row.subtype, pool: row.pool });
        }

        return NextResponse.json({
            success: true,
            mock: {
                mock_test_id: mock.mock_test_id,
                exam_id: mock.exam_id,
                name: mock.name,
                slug: mock.slug,
                status: mock.status,
                type: mock.type,
                created_at: mock.created_at,
                published_at: mock.published_at,
                stats: stats,
            },
            sections: SECTION_CODES.map(code => ({
                code,
                items: bySection[code],
                bank_pool: poolBySection[code],
            })),
        });
    } catch (e) {
        console.error('cgl-mock/[id] error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
