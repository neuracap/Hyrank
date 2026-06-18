import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { getSpecByExamId, getSpec } from '@/lib/mock-spec-resolver';

export const dynamic = 'force-dynamic';

const TARGET_SECTIONS = ['GA', 'REASONING', 'QUANT'];

/**
 * GET /api/mock-test/[id]/hindi-review
 *
 * Per-mock Hindi review queue. Returns each translatable question with EN and
 * HI side-by-side (body + 4 options), plus the HI row's review status.
 *
 * Two storage models are handled transparently:
 *   - Composite-key (CGL / CHSL legacy): HI question_version lives on the
 *     same question_id as the EN qv (different `language` column value).
 *   - Linked-qid (GD): HI lives on a separate question_id, paired to the
 *     EN qid via question_links. Resolved with a LATERAL preferring
 *     human-corrected links over machine-translated.
 *
 * Response shape uses the EN qid as the row's `question_id` and version_no
 * (so /edit + /approve continue to identify rows by the EN handle), but
 * adds `hi_question_id` / `hi_version_no` when the HI side lives on a
 * different qid. The two write routes use these to mutate the right row.
 */
export async function GET(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;

    const client = await db.connect();
    try {
        const mockRes = await client.query(
            `SELECT mock_test_id, exam_id, name, status, stats_json
             FROM mock_test WHERE mock_test_id = $1`,
            [mockTestId]
        );
        if (mockRes.rows.length === 0) {
            return NextResponse.json({ error: 'Mock not found' }, { status: 404 });
        }
        const mock = mockRes.rows[0];

        const SPEC = getSpecByExamId(mock.exam_id) || getSpec('cgl-t1');
        const { TARGET_SECTION_IDS, SECTION_CODES } = SPEC;
        const targetSectionIds = TARGET_SECTIONS.map(c => TARGET_SECTION_IDS[c]);
        const codeBySectionId = Object.fromEntries(
            SECTION_CODES.map(c => [TARGET_SECTION_IDS[c], c])
        );

        // Resolve the EN→HI binding per mtq row, then JOIN the HI qv on
        // the resolved hindi_question_id (linked-qid model). Falls back to
        // the same question_id when no link exists (composite-key model).
        const qRes = await client.query(`
            SELECT mtq.position, mtq.exam_section_id,
                   en.question_id AS en_qid, en.version_no AS en_version_no,
                   en.body_json     AS en_body,
                   en.correct_option_label,
                   en.difficulty,
                   en.subtype,
                   COALESCE(ql.hindi_question_id, en.question_id) AS hi_qid,
                   COALESCE(ql.hindi_version_no, en.version_no)   AS hi_version_no,
                   ql.id            AS link_id,
                   ql.status        AS link_status,
                   hi.body_json     AS hi_body,
                   hi.status        AS hi_status,
                   hi.updated_at    AS hi_updated_at
            FROM mock_test_question mtq
            JOIN question_version en
              ON en.question_id = mtq.question_id
             AND en.language = 'EN'
             AND en.version_no = (
                 SELECT MAX(version_no) FROM question_version
                 WHERE question_id = mtq.question_id AND language = 'EN'
             )
            LEFT JOIN LATERAL (
                SELECT q.id, q.hindi_question_id, q.hindi_version_no, q.status
                FROM question_links q
                WHERE q.english_question_id = en.question_id
                ORDER BY
                    CASE q.status
                        WHEN 'MANUALLY_CORRECTED' THEN 0
                        WHEN 'LINKED'             THEN 1
                        WHEN 'PENDING'            THEN 2
                        WHEN 'MACHINE_TRANSLATED' THEN 3
                        ELSE 4
                    END,
                    q.id ASC
                LIMIT 1
            ) ql ON true
            LEFT JOIN question_version hi
              ON hi.question_id = COALESCE(ql.hindi_question_id, en.question_id)
             AND hi.version_no  = COALESCE(ql.hindi_version_no, en.version_no)
             AND hi.language    = 'HI'
            WHERE mtq.mock_test_id = $1
              AND mtq.exam_section_id = ANY($2)
            ORDER BY mtq.exam_section_id, mtq.position
        `, [mockTestId, targetSectionIds]);

        if (qRes.rows.length === 0) {
            return NextResponse.json({
                success: true,
                mock: { mock_test_id: mock.mock_test_id, name: mock.name, status: mock.status, stats: mock.stats_json || {} },
                items: [],
                review_stats: { total: 0, translated: 0, approved: 0, by_section: [] },
            });
        }

        // Options for both sides. The HI qid may differ from the EN qid in
        // the linked-qid model, so collect both sets of qid+version+lang.
        const enKeys = qRes.rows.map(r => [r.en_qid, r.en_version_no, 'EN']);
        const hiKeys = qRes.rows.map(r => [r.hi_qid, r.hi_version_no, 'HI']);
        const allKeys = [...enKeys, ...hiKeys];
        const distinctQids = [...new Set(allKeys.map(([q]) => q))];

        const optsRes = await client.query(`
            SELECT question_id, version_no, language, option_key, option_json
            FROM question_option
            WHERE question_id = ANY($1) AND language IN ('EN','HI')
        `, [distinctQids]);
        const optsByQ = {};
        for (const row of optsRes.rows) {
            const key = `${row.question_id}:${row.version_no}:${row.language}`;
            if (!optsByQ[key]) optsByQ[key] = {};
            optsByQ[key][row.option_key] = row.option_json;
        }

        const items = qRes.rows.map(r => ({
            position: r.position,
            section_code: codeBySectionId[r.exam_section_id] || '?',
            // Public handle = EN qid (preserves /edit and /approve signature)
            question_id: r.en_qid,
            version_no: r.en_version_no,
            // Internal HI handles surfaced for write routes
            hi_question_id: r.hi_qid,
            hi_version_no: r.hi_version_no,
            link_status: r.link_status || null,
            correct_option_label: r.correct_option_label,
            difficulty: r.difficulty,
            subtype: r.subtype,
            en: {
                body_json: r.en_body,
                options: optsByQ[`${r.en_qid}:${r.en_version_no}:EN`] || {},
            },
            hi: r.hi_body == null ? null : {
                body_json: r.hi_body,
                options: optsByQ[`${r.hi_qid}:${r.hi_version_no}:HI`] || {},
                status: r.hi_status,
                updated_at: r.hi_updated_at,
            },
        }));

        const stats = {
            total: items.length,
            translated: items.filter(i => i.hi != null).length,
            approved: items.filter(i => i.hi?.status === 'APPROVED').length,
            by_section: TARGET_SECTIONS.map(c => ({
                code: c,
                total: items.filter(i => i.section_code === c).length,
                translated: items.filter(i => i.section_code === c && i.hi != null).length,
                approved: items.filter(i => i.section_code === c && i.hi?.status === 'APPROVED').length,
            })),
        };

        return NextResponse.json({
            success: true,
            mock: {
                mock_test_id: mock.mock_test_id,
                name: mock.name,
                status: mock.status,
                stats: mock.stats_json || {},
            },
            items,
            review_stats: stats,
        });
    } catch (e) {
        console.error('mock-test/hindi-review list error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
