import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mock-test/[id]/hindi-review/approve
 *
 * Body: { question_id, version_no }
 * Flips question_version (HI) status='APPROVED' for one question of this
 * mock. Handles both bilingual models:
 *   - composite-key: HI lives on the same qid (CGL / CHSL).
 *   - linked-qid: HI on a different qid via question_links (GD).
 *
 * Also accepts: { all: true } — approves every translated HI row in this mock.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const client = await db.connect();
    try {
        if (body?.all === true) {
            // Both models in one shot: the target HI qid is whichever the
            // best link points to, OR the same qid if no link exists.
            const r = await client.query(`
                UPDATE question_version qv
                SET status = 'APPROVED', updated_at = NOW()
                FROM mock_test_question mtq
                LEFT JOIN LATERAL (
                    SELECT q.hindi_question_id, q.hindi_version_no
                    FROM question_links q
                    WHERE q.english_question_id = mtq.question_id
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
                WHERE mtq.mock_test_id = $1
                  AND qv.question_id = COALESCE(ql.hindi_question_id, mtq.question_id)
                  AND qv.language = 'HI'
                  AND qv.status != 'APPROVED'
                RETURNING qv.question_id
            `, [mockTestId]);
            return NextResponse.json({ success: true, approved: r.rowCount });
        }

        const { question_id, version_no } = body || {};
        if (!question_id || version_no == null) {
            return NextResponse.json({ error: 'question_id and version_no required' }, { status: 400 });
        }
        const present = await client.query(
            `SELECT 1 FROM mock_test_question WHERE mock_test_id = $1 AND question_id = $2`,
            [mockTestId, question_id]
        );
        if (present.rows.length === 0) {
            return NextResponse.json({ error: 'Question not in this mock' }, { status: 404 });
        }

        const linkRes = await client.query(`
            SELECT hindi_question_id, hindi_version_no
            FROM question_links
            WHERE english_question_id = $1
            ORDER BY
                CASE status
                    WHEN 'MANUALLY_CORRECTED' THEN 0
                    WHEN 'LINKED'             THEN 1
                    WHEN 'PENDING'            THEN 2
                    WHEN 'MACHINE_TRANSLATED' THEN 3
                    ELSE 4
                END,
                id ASC
            LIMIT 1
        `, [question_id]);
        const hiQid = linkRes.rows[0]?.hindi_question_id || question_id;
        const hiVersion = linkRes.rows[0]?.hindi_version_no ?? version_no;

        const r = await client.query(`
            UPDATE question_version
            SET status = 'APPROVED', updated_at = NOW()
            WHERE question_id = $1 AND version_no = $2 AND language = 'HI'
            RETURNING question_id
        `, [hiQid, hiVersion]);
        if (r.rowCount === 0) {
            return NextResponse.json({ error: 'HI version not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, approved: 1 });
    } catch (e) {
        console.error('hindi-review/approve error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
