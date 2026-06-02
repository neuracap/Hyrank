import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const VALID_LABELS = ['A', 'B', 'C', 'D'];

/**
 * POST /api/cgl-mock/[id]/edit-question
 *
 * Body:
 *   question_id            (uuid, required)
 *   stem                   (string, optional — replaces body_json.text)
 *   options                (object {A,B,C,D}, optional — partial allowed;
 *                           each entry replaces that option's option_json.text)
 *   correct_option_label   ('A'|'B'|'C'|'D', optional)
 *
 * Behavior:
 *   - Verifies the question is in this CGL T1 mock (refuses otherwise).
 *   - Updates question_version.body_json.text (preserves other body_json keys).
 *   - Updates question_option.option_json.text for each provided option.
 *   - When correct_option_label is provided: updates question_version.correct_option_label
 *     AND syncs question_option.is_correct so the chosen option is true and the
 *     others false. (For shared bank rows this changes the answer globally —
 *     intentional; the caller is editing in place.)
 *   - Appends a {by, at, fields} marker to meta_json.edit_history for audit.
 *
 * IMPORTANT: question_version PK is composite (question_id, version_no, language).
 * We always pin language='EN' and version_no = (latest for this question_id).
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { question_id, stem, options, correct_option_label, difficulty } = body;
    if (!question_id) return NextResponse.json({ error: 'question_id required' }, { status: 400 });
    if (correct_option_label && !VALID_LABELS.includes(correct_option_label)) {
        return NextResponse.json({ error: 'correct_option_label must be A, B, C, or D' }, { status: 400 });
    }
    if (options && typeof options !== 'object') {
        return NextResponse.json({ error: 'options must be an object {A,B,C,D}' }, { status: 400 });
    }
    if (difficulty != null && (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 4)) {
        return NextResponse.json({ error: 'difficulty must be an integer 1-4' }, { status: 400 });
    }
    if (stem == null && !options && !correct_option_label && difficulty == null) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Sanity: question must be part of this mock.
        const presentRes = await client.query(
            `SELECT 1 FROM mock_test_question WHERE mock_test_id = $1 AND question_id = $2`,
            [mockTestId, question_id]
        );
        if (presentRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Question is not part of this mock' }, { status: 404 });
        }

        // Find the latest EN version.
        const versionRes = await client.query(
            `SELECT version_no, body_json, meta_json
             FROM question_version
             WHERE question_id = $1 AND language = 'EN'
             ORDER BY version_no DESC LIMIT 1`,
            [question_id]
        );
        if (versionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'No EN version found for this question' }, { status: 404 });
        }
        const { version_no, body_json, meta_json } = versionRes.rows[0];
        const changed = [];

        // body_json.text update
        let newBody = body_json;
        if (typeof stem === 'string') {
            newBody = { ...(body_json || {}), text: stem };
            changed.push('body_text');
        }

        // correct_option_label
        let newCorrect = null;
        if (correct_option_label) {
            newCorrect = correct_option_label;
            changed.push('correct_option_label');
        }

        // difficulty
        let newDifficulty = null;
        if (difficulty != null) {
            newDifficulty = difficulty;
            changed.push('difficulty');
        }

        // meta_json edit history append (preserve everything)
        const histEntry = {
            by: user.id,
            by_name: user.name || user.email || null,
            at: new Date().toISOString(),
            mock_test_id: mockTestId,
            fields: [...changed],
        };

        // Build new meta_json
        const meta = meta_json || {};
        const history = Array.isArray(meta.edit_history) ? meta.edit_history : [];
        const newMeta = { ...meta, edit_history: [...history, histEntry] };
        if (options && Object.keys(options).length > 0) {
            histEntry.fields.push(...Object.keys(options).map(k => `option_${k}`));
        }

        // Update question_version (single statement, only set what changed)
        // We always write meta_json to record the audit entry.
        await client.query(`
            UPDATE question_version
            SET body_json            = $1::jsonb,
                correct_option_label = COALESCE($2, correct_option_label),
                difficulty           = COALESCE($3, difficulty),
                meta_json            = $4::jsonb,
                updated_at           = NOW()
            WHERE question_id = $5 AND version_no = $6 AND language = 'EN'
        `, [JSON.stringify(newBody), newCorrect, newDifficulty, JSON.stringify(newMeta), question_id, version_no]);

        // If slot_difficulty exists on mock_test_question, keep it consistent
        // (only when difficulty was explicitly changed).
        if (newDifficulty != null) {
            await client.query(`
                UPDATE mock_test_question
                SET slot_difficulty = $1
                WHERE mock_test_id = $2 AND question_id = $3
            `, [String(newDifficulty), mockTestId, question_id]);
        }

        // Options text updates (partial allowed)
        if (options) {
            for (const k of VALID_LABELS) {
                const text = options[k];
                if (typeof text !== 'string') continue;
                const optRes = await client.query(
                    `SELECT option_json FROM question_option
                     WHERE question_id = $1 AND version_no = $2 AND language = 'EN' AND option_key = $3`,
                    [question_id, version_no, k]
                );
                const cur = optRes.rows[0]?.option_json || {};
                const next = { ...cur, text };
                await client.query(`
                    UPDATE question_option SET option_json = $1::jsonb
                    WHERE question_id = $2 AND version_no = $3 AND language = 'EN' AND option_key = $4
                `, [JSON.stringify(next), question_id, version_no, k]);
            }
        }

        // Sync is_correct on options when the correct label changed.
        if (newCorrect) {
            await client.query(`
                UPDATE question_option
                SET is_correct = (option_key = $1)
                WHERE question_id = $2 AND version_no = $3 AND language = 'EN'
            `, [newCorrect, question_id, version_no]);
        }

        // Recompute has_image from the now-saved body + all options.
        const allTextRes = await client.query(`
            SELECT
                (body_json->>'text') AS body_text,
                (
                    SELECT string_agg(qo.option_json->>'text', ' ')
                    FROM question_option qo
                    WHERE qo.question_id = $1 AND qo.version_no = $2 AND qo.language = 'EN'
                ) AS options_text
            FROM question_version
            WHERE question_id = $1 AND version_no = $2 AND language = 'EN'
        `, [question_id, version_no]);
        const combined = `${allTextRes.rows[0]?.body_text || ''} ${allTextRes.rows[0]?.options_text || ''}`;
        const hasImage = /\\includegraphics|!\[.*?\]\(.*?\)/.test(combined);
        await client.query(
            `UPDATE question_version SET has_image = $1 WHERE question_id = $2 AND version_no = $3 AND language = 'EN'`,
            [hasImage, question_id, version_no]
        );

        await client.query('COMMIT');
        return NextResponse.json({
            success: true,
            question_id,
            version_no,
            changed_fields: histEntry.fields,
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('cgl-mock/edit-question error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
