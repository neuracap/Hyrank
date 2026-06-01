import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import {
    CGL_T1_EXAM_ID, BANK_SECTION_IDS, SECTION_CODES,
    SECTION_SPEC, SUBTYPE_PREFIXES,
} from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cgl-mock/search-bank
 *   ?section=REASONING|GA|QUANT|ENGLISH         (required)
 *   ?spec_subtype=<spec slug>                   (optional — e.g. "arithmetic", "advanced", "history")
 *   ?difficulty=2|3                             (optional)
 *   ?q=<text>                                   (optional — ILIKE on body_json.text)
 *   ?limit=20  ?offset=0
 *
 * Returns verified bank questions matching the filters and never picked into
 * any CGL T1 mock yet. Also returns `subtype_buckets`: the spec-level subtype
 * options for the chosen section with current available pool counts (after
 * applying the exclusion).
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const section = (searchParams.get('section') || '').toUpperCase();
    if (!SECTION_CODES.includes(section)) {
        return NextResponse.json({ error: 'section must be REASONING, GA, QUANT, or ENGLISH' }, { status: 400 });
    }
    const specSubtype = (searchParams.get('spec_subtype') || '').trim();
    const difficulty = searchParams.get('difficulty');
    const q = (searchParams.get('q') || '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

    const bankSectionId = BANK_SECTION_IDS[section];

    // Build the candidate spec-subtypes for this section (targets + remainders)
    const sectionSpec = SECTION_SPEC[section] || {};
    const candidateSpecSlugs = Array.from(new Set([
        ...Object.keys(sectionSpec.targets || {}),
        ...(sectionSpec.remainder_subtypes || []),
    ]));

    const conditions = [
        `qv.source_type = 'bank'`,
        `qv.question_type = 'MCQ'`,
        `qv.language = 'EN'`,
        `qv.solution_status = 'DONE'`,
        `qv.correct_option_label IS NOT NULL`,
        `COALESCE(qv.status, '') != 'JUNK'`,
        `COALESCE((qv.meta_json->'resolve'->>'match')::boolean, true) = true`,
        `qv.exam_section_id = $1`,
        `qv.difficulty IN (2, 3)`,
    ];
    const params = [bankSectionId];

    if (difficulty === '2' || difficulty === '3') {
        params.push(parseInt(difficulty, 10));
        conditions.push(`qv.difficulty = $${params.length}`);
    }

    if (specSubtype) {
        const prefixes = SUBTYPE_PREFIXES[specSubtype];
        if (!prefixes || prefixes.length === 0) {
            return NextResponse.json({ error: `Unknown spec_subtype: ${specSubtype}` }, { status: 400 });
        }
        params.push(prefixes);
        conditions.push(`qv.subtype LIKE ANY($${params.length})`);
    }

    if (q) {
        params.push(`%${q}%`);
        conditions.push(`(qv.body_json->>'text') ILIKE $${params.length}`);
    }

    // Exclusion: question never used in any CGL T1 mock (any status).
    params.push(CGL_T1_EXAM_ID);
    conditions.push(`NOT EXISTS (
        SELECT 1 FROM mock_test_question mtq
        JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
        WHERE mtq.question_id = qv.question_id AND mt.exam_id = $${params.length}
    )`);

    const where = conditions.join(' AND ');
    const client = await db.connect();
    try {
        const totalRes = await client.query(`
            SELECT COUNT(*)::int AS c
            FROM question_version qv
            WHERE ${where}
        `, params);
        const total = totalRes.rows[0].c;

        params.push(limit, offset);
        const listRes = await client.query(`
            SELECT qv.question_id, qv.version_no, qv.difficulty, qv.subtype,
                   qv.correct_option_label, qv.body_json,
                   (qv.meta_json->>'variation') AS variation,
                   (
                       SELECT jsonb_object_agg(qo.option_key, qo.option_json ORDER BY qo.option_key)
                       FROM question_option qo
                       WHERE qo.question_id = qv.question_id
                         AND qo.version_no  = qv.version_no
                         AND qo.language    = 'EN'
                   ) AS options
            FROM question_version qv
            WHERE ${where}
            ORDER BY qv.question_id
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        // Subtype buckets — same exclusions, but grouped by spec-slug with counts.
        // We compute this by running a per-slug count using LIKE ANY (its prefixes).
        const buckets = [];
        for (const slug of candidateSpecSlugs) {
            const prefixes = SUBTYPE_PREFIXES[slug] || [];
            if (prefixes.length === 0) { buckets.push({ slug, count: 0 }); continue; }
            const bRes = await client.query(`
                SELECT COUNT(*)::int AS c
                FROM question_version qv
                WHERE qv.source_type='bank' AND qv.question_type='MCQ' AND qv.language='EN'
                  AND qv.solution_status='DONE' AND qv.correct_option_label IS NOT NULL
                  AND COALESCE(qv.status,'') != 'JUNK'
                  AND COALESCE((qv.meta_json->'resolve'->>'match')::boolean,true)=true
                  AND qv.exam_section_id = $1
                  AND qv.difficulty IN (2,3)
                  AND qv.subtype LIKE ANY($2)
                  AND NOT EXISTS (
                      SELECT 1 FROM mock_test_question mtq
                      JOIN mock_test mt ON mt.mock_test_id = mtq.mock_test_id
                      WHERE mtq.question_id = qv.question_id AND mt.exam_id = $3
                  )
            `, [bankSectionId, prefixes, CGL_T1_EXAM_ID]);
            buckets.push({ slug, count: bRes.rows[0].c });
        }

        return NextResponse.json({
            success: true,
            total,
            rows: listRes.rows,
            subtype_buckets: buckets,
        });
    } catch (e) {
        console.error('cgl-mock/search-bank error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
