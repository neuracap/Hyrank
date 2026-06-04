import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cgl-mock/[id]/edit-passage
 *
 * Body: { group_id, passage_text }
 *
 * Updates the EN passage text for a group (RC / Cloze) used in this mock.
 * The passage lives on the question_version row referenced by
 * question_group.passage_question_id — separate from the member question rows
 * that the existing edit-question route handles.
 *
 * Safety: the group must have at least one member currently in this mock,
 * to prevent arbitrary writes via crafted group_ids.
 *
 * HI passage is NOT touched here. Use the bilingual edit flow if you need to
 * keep the Hindi mirror in sync.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { group_id, passage_text } = body || {};
    if (!group_id) return NextResponse.json({ error: 'group_id required' }, { status: 400 });
    if (typeof passage_text !== 'string') {
        return NextResponse.json({ error: 'passage_text must be a string' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Safety check: this group must have a member in this mock.
        const present = await client.query(
            `SELECT 1 FROM mock_test_question
             WHERE mock_test_id = $1 AND group_id = $2 LIMIT 1`,
            [mockTestId, group_id]
        );
        if (present.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Group not present in this mock' }, { status: 404 });
        }

        // Resolve passage_question_id
        const groupRes = await client.query(
            `SELECT passage_question_id FROM question_group WHERE group_id = $1`,
            [group_id]
        );
        const passageQid = groupRes.rows[0]?.passage_question_id;
        if (!passageQid) {
            await client.query('ROLLBACK');
            return NextResponse.json({
                error: 'This group has no passage_question_id — passage is not stored as an editable row',
            }, { status: 409 });
        }

        // Find latest EN version of the passage row
        const versionRes = await client.query(
            `SELECT version_no, body_json, meta_json
             FROM question_version
             WHERE question_id = $1 AND language = 'EN'
             ORDER BY version_no DESC LIMIT 1`,
            [passageQid]
        );
        if (versionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'No EN version found for the passage' }, { status: 404 });
        }
        const { version_no, body_json, meta_json } = versionRes.rows[0];
        const newBody = { ...(body_json || {}), text: passage_text };

        // Audit
        const meta = meta_json || {};
        const history = Array.isArray(meta.edit_history) ? meta.edit_history : [];
        const histEntry = {
            by: user.id,
            by_name: user.name || user.email || null,
            at: new Date().toISOString(),
            mock_test_id: mockTestId,
            fields: ['passage_text'],
        };
        const newMeta = { ...meta, edit_history: [...history, histEntry] };

        await client.query(
            `UPDATE question_version
             SET body_json = $1::jsonb,
                 meta_json = $2::jsonb,
                 updated_at = NOW()
             WHERE question_id = $3 AND version_no = $4 AND language = 'EN'`,
            [JSON.stringify(newBody), JSON.stringify(newMeta), passageQid, version_no]
        );

        await client.query('COMMIT');
        return NextResponse.json({
            success: true,
            group_id,
            passage_question_id: passageQid,
            version_no,
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('cgl-mock/edit-passage error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
