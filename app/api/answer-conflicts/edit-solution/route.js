import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/answer-conflicts/edit-solution
 * Lets a reviewer rewrite the worked solution so it matches the resolved
 * answer. Merges edits into the existing solution_json (all other top-level
 * keys — quality_check, language_check, indexing_metadata, etc. — are
 * preserved). Appends a marker entry to final_resolution_history.
 *
 * Body (all optional except the identifiers; only provided fields are touched):
 *   question_id        (uuid, required)
 *   version_no         (int, required)
 *   core_answer_basis  (string)
 *   final_answer_text  (string)
 *   correct_option     ('A'|'B'|'C'|'D')
 *   display_sections   (array of { key, content }) — replaces the array wholesale
 *   clear_figure       (boolean) — unsets answer_outcome.figure_url; used when
 *                                  the solver-embedded figure is wrong/junk and
 *                                  the reviewer wants to drop it
 *   figure_url         (string)  — replaces answer_outcome.figure_url with this
 *                                  value (e.g. after uploading a corrected image)
 */
const VALID_LABELS = ['A', 'B', 'C', 'D'];

export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { question_id, version_no } = body;
    if (!question_id || version_no == null) {
        return NextResponse.json({ error: 'Missing question_id or version_no' }, { status: 400 });
    }

    if (body.correct_option != null && !VALID_LABELS.includes(body.correct_option)) {
        return NextResponse.json({ error: 'correct_option must be A, B, C, or D' }, { status: 400 });
    }
    if (body.display_sections != null && !Array.isArray(body.display_sections)) {
        return NextResponse.json({ error: 'display_sections must be an array' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const cur = await client.query(`
            SELECT solution_json
            FROM question_version
            WHERE question_id = $1 AND version_no = $2 AND language = 'EN'
            FOR UPDATE
        `, [question_id, version_no]);

        if (cur.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Question version not found' }, { status: 404 });
        }

        const current = cur.rows[0].solution_json || {};
        const next = { ...current };
        const changed = [];

        const aoChanges = {};
        if (typeof body.core_answer_basis === 'string') {
            aoChanges.core_answer_basis = body.core_answer_basis;
            changed.push('answer_outcome.core_answer_basis');
        }
        if (typeof body.final_answer_text === 'string') {
            aoChanges.final_answer_text = body.final_answer_text;
            changed.push('answer_outcome.final_answer_text');
        }
        if (body.correct_option) {
            aoChanges.correct_option = body.correct_option;
            changed.push('answer_outcome.correct_option');
        }
        // Figure handling: clear takes precedence over replace. Both flow through
        // answer_outcome and get merged with the rest of the partial update.
        let clearFigure = false;
        if (body.clear_figure === true) {
            clearFigure = true;
            changed.push('answer_outcome.figure_url:cleared');
        } else if (typeof body.figure_url === 'string' && body.figure_url.trim()) {
            aoChanges.figure_url = body.figure_url.trim();
            changed.push('answer_outcome.figure_url');
        }
        if (Object.keys(aoChanges).length > 0 || clearFigure) {
            const merged = { ...(current.answer_outcome || {}), ...aoChanges };
            if (clearFigure) delete merged.figure_url;
            next.answer_outcome = merged;
        }

        if (body.display_sections) {
            next.display_sections = body.display_sections.map(s => ({
                key: String(s.key || ''),
                content: String(s.content || ''),
            }));
            changed.push('display_sections');
        }

        if (changed.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        const historyEntry = {
            action: 'solution_edit',
            fields: changed,
            by: user.id,
            by_name: user.name || user.email || null,
            at: new Date().toISOString(),
        };

        await client.query(`
            UPDATE question_version
            SET solution_json = $1::jsonb,
                final_resolution_history = COALESCE(final_resolution_history, '[]'::jsonb) || $2::jsonb
            WHERE question_id = $3 AND version_no = $4 AND language = 'EN'
        `, [JSON.stringify(next), JSON.stringify(historyEntry), question_id, version_no]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            question_id,
            version_no,
            solution_json: next,
            changed_fields: changed,
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('answer-conflicts edit-solution error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
