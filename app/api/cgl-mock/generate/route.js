import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import {
    CGL_T1_EXAM_ID, TARGET_SECTION_IDS, BANK_SECTION_IDS,
    SECTION_CODES, normalizeConfig,
} from '@/lib/cgl-mock-spec';
import { buildMock } from '@/lib/cgl-mock-picker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/cgl-mock/generate
 * Body: MOCK CONFIGURATION + optional `name`.
 * Generates a DRAFT SSC CGL Tier 1 mock from the verified bank pool,
 * excluding question_ids used in any prior CGL T1 mock_test (any status).
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch { body = {}; }
    const config = normalizeConfig(body);
    const requestedName = (body.name || '').trim();

    const client = await db.connect();
    try {
        // 1) Exclusion set: every question_id ever used in a CGL T1 mock.
        const exclRes = await client.query(`
            SELECT DISTINCT mtq.question_id
            FROM mock_test_question mtq
            JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
            WHERE mt.exam_id = $1
        `, [CGL_T1_EXAM_ID]);
        const excludedIds = new Set(exclRes.rows.map(r => r.question_id));

        // 2) Pool — verified bank questions per bank section.
        const bankSectionIds = SECTION_CODES.map(c => BANK_SECTION_IDS[c]);
        const poolRes = await client.query(`
            SELECT qv.question_id, qv.exam_section_id, qv.subtype, qv.difficulty,
                   qv.leaf_topic_id, qv.group_id, qv.group_order,
                   qv.correct_option_label,
                   qv.body_json,
                   (qv.meta_json->>'variation') AS variation
            FROM question_version qv
            WHERE qv.source_type = 'bank'
              AND qv.question_type = 'MCQ'
              AND qv.language = 'EN'
              AND qv.solution_status = 'DONE'
              AND qv.correct_option_label IS NOT NULL
              AND COALESCE((qv.meta_json->'resolve'->>'match')::boolean, true) = true
              AND qv.exam_section_id = ANY($1)
              AND qv.difficulty IN (2, 3)
        `, [bankSectionIds]);

        const byBankSectionId = Object.fromEntries(
            SECTION_CODES.map(c => [BANK_SECTION_IDS[c], c])
        );
        const poolsBySection = { REASONING: [], GA: [], QUANT: [], ENGLISH: [] };
        for (const row of poolRes.rows) {
            const code = byBankSectionId[row.exam_section_id];
            if (code) poolsBySection[code].push(row);
        }

        // 3) Groups: load full membership for any group_id present in the pool
        //    plus their stimulus question_id.
        const grpRes = await client.query(`
            SELECT qg.group_id, qg.group_type, qg.passage_question_id,
                   qg.exam_section_id,
                   qv.question_id, qv.group_order, qv.difficulty, qv.subtype,
                   qv.leaf_topic_id, qv.correct_option_label, qv.body_json,
                   qv.solution_status, qv.meta_json
            FROM question_group qg
            JOIN question_version qv
              ON qv.group_id = qg.group_id
             AND qv.language = 'EN'
             AND qv.question_type = 'MCQ'
             AND qv.source_type = 'bank'
            WHERE qg.exam_section_id = ANY($1)
              AND qv.solution_status = 'DONE'
              AND qv.correct_option_label IS NOT NULL
              AND qv.difficulty IN (2, 3)
            ORDER BY qg.group_id, qv.group_order NULLS LAST
        `, [bankSectionIds]);

        const groupsMap = new Map();
        for (const row of grpRes.rows) {
            if (!groupsMap.has(row.group_id)) {
                groupsMap.set(row.group_id, {
                    group_id: row.group_id,
                    group_type: row.group_type,
                    passage_question_id: row.passage_question_id,
                    section_code: byBankSectionId[row.exam_section_id],
                    members: [],
                });
            }
            groupsMap.get(row.group_id).members.push({
                question_id: row.question_id,
                group_order: row.group_order,
                difficulty: row.difficulty,
                subtype: row.subtype,
                leaf_topic_id: row.leaf_topic_id,
                correct_option_label: row.correct_option_label,
            });
        }
        const groups = [...groupsMap.values()];

        // 4) Run the picker.
        const picker = buildMock({
            config,
            poolsBySection,
            groups,
            excludedIds,
        });

        // 5) Persist: mock_test + mock_test_question.
        const name = requestedName ||
            `CGL T1 Mock — ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
        const slug = `cgl-t1-${Date.now().toString(36)}`;

        await client.query('BEGIN');

        const mockRes = await client.query(`
            INSERT INTO mock_test
              (exam_id, name, slug, status, type, stats_json, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, 'DRAFT', 'MOCK', $4, $5, NOW(), NOW())
            RETURNING mock_test_id
        `, [
            CGL_T1_EXAM_ID,
            name,
            slug,
            JSON.stringify({
                builder: 'cgl-mock-builder',
                config: picker.config,
                placeholders: picker.placeholders,
                section_stats: picker.section_stats,
                notes: picker.notes,
                generated_at: new Date().toISOString(),
                generated_by: user.id,
            }),
            user.id,
        ]);
        const mockTestId = mockRes.rows[0].mock_test_id;

        for (const item of picker.items) {
            await client.query(`
                INSERT INTO mock_test_question
                  (mock_test_id, question_id, exam_section_id, position,
                   slot_subtype, slot_difficulty, group_id, review_status, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', NOW())
            `, [
                mockTestId,
                item.question_id,
                TARGET_SECTION_IDS[item.section_code],
                item.position,
                item.slot_subtype,
                item.slot_difficulty != null ? String(item.slot_difficulty) : null,
                item.group_id,
            ]);
        }

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            mock_test_id: mockTestId,
            name,
            section_stats: picker.section_stats,
            placeholders: picker.placeholders,
            notes: picker.notes,
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('cgl-mock/generate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
