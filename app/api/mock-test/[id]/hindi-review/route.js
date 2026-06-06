import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { TARGET_SECTION_IDS, SECTION_CODES } from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';

const TARGET_SECTIONS = ['GA', 'REASONING', 'QUANT'];

/**
 * GET /api/mock-test/[id]/hindi-review
 *
 * Per-mock Hindi review queue. Returns each translatable question with EN and
 * HI side-by-side (body + 4 options), plus the HI row's review status.
 */
export async function GET(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;

    const targetSectionIds = TARGET_SECTIONS.map(c => TARGET_SECTION_IDS[c]);
    const codeBySectionId = Object.fromEntries(
        SECTION_CODES.map(c => [TARGET_SECTION_IDS[c], c])
    );

    const client = await db.connect();
    try {
        const mockRes = await client.query(
            `SELECT mock_test_id, name, status, stats_json FROM mock_test WHERE mock_test_id = $1`,
            [mockTestId]
        );
        if (mockRes.rows.length === 0) {
            return NextResponse.json({ error: 'Mock not found' }, { status: 404 });
        }
        const mock = mockRes.rows[0];

        const qRes = await client.query(`
            SELECT mtq.position, mtq.exam_section_id,
                   en.question_id, en.version_no,
                   en.body_json     AS en_body,
                   en.correct_option_label,
                   en.difficulty,
                   en.subtype,
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
            LEFT JOIN question_version hi
              ON hi.question_id = en.question_id
             AND hi.version_no  = en.version_no
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
            });
        }

        const qids = qRes.rows.map(r => r.question_id);
        const optsRes = await client.query(`
            SELECT question_id, version_no, language, option_key, option_json
            FROM question_option
            WHERE question_id = ANY($1) AND language IN ('EN','HI')
        `, [qids]);
        const optsByQ = {};
        for (const row of optsRes.rows) {
            const key = `${row.question_id}:${row.version_no}:${row.language}`;
            if (!optsByQ[key]) optsByQ[key] = {};
            optsByQ[key][row.option_key] = row.option_json;
        }

        const items = qRes.rows.map(r => ({
            position: r.position,
            section_code: codeBySectionId[r.exam_section_id] || '?',
            question_id: r.question_id,
            version_no: r.version_no,
            correct_option_label: r.correct_option_label,
            difficulty: r.difficulty,
            subtype: r.subtype,
            en: {
                body_json: r.en_body,
                options: optsByQ[`${r.question_id}:${r.version_no}:EN`] || {},
            },
            hi: r.hi_body == null ? null : {
                body_json: r.hi_body,
                options: optsByQ[`${r.question_id}:${r.version_no}:HI`] || {},
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
