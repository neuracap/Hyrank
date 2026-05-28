import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/answer-conflicts/resolve
 * Records a reviewer's verdict on one EN conflict. Does NOT touch
 * question_option.is_correct — that promotion is a later bulk step.
 *
 * Body:
 *   question_id  (uuid, required)
 *   version_no   (int, required)
 *   verdict      ('A'|'B'|'C'|'D'|'needs_expert', required)
 *
 * Derives final_answer_source from the verdict vs the two candidate answers:
 *   verdict == solution_answer   -> conflict_resolved_solution
 *   verdict == answer_key_answer -> conflict_resolved_pdf
 *   verdict is another label     -> conflict_resolved_other
 *   verdict == 'needs_expert'    -> needs_expert (final_correct_option_label stays NULL)
 *
 * Appends an entry to final_resolution_history (append-only audit trail).
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

    const { question_id, version_no, verdict } = body;
    if (!question_id || version_no == null || !verdict) {
        return NextResponse.json({ error: 'Missing question_id, version_no, or verdict' }, { status: 400 });
    }
    if (verdict !== 'needs_expert' && !VALID_LABELS.includes(verdict)) {
        return NextResponse.json({ error: 'verdict must be A, B, C, D, or needs_expert' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Lock the EN row and read the two candidate answers
        const cur = await client.query(`
            SELECT correct_option_label AS solution_answer,
                   pdf_correct_option_label AS answer_key_answer
            FROM question_version
            WHERE question_id = $1 AND version_no = $2 AND language = 'EN'
            FOR UPDATE
        `, [question_id, version_no]);

        if (cur.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Conflict row not found' }, { status: 404 });
        }

        const { solution_answer, answer_key_answer } = cur.rows[0];

        let finalLabel = null;
        let source;
        if (verdict === 'needs_expert') {
            finalLabel = null;
            source = 'needs_expert';
        } else {
            finalLabel = verdict;
            if (verdict === solution_answer) source = 'conflict_resolved_solution';
            else if (verdict === answer_key_answer) source = 'conflict_resolved_pdf';
            else source = 'conflict_resolved_other';
        }

        const historyEntry = {
            verdict,
            final_label: finalLabel,
            source,
            by: user.id,
            by_name: user.name || user.email || null,
            at: new Date().toISOString(),
        };

        await client.query(`
            UPDATE question_version
            SET final_correct_option_label = $1,
                final_answer_source        = $2,
                final_resolved_by          = $3,
                final_resolved_at          = NOW(),
                final_resolution_history   = COALESCE(final_resolution_history, '[]'::jsonb) || $4::jsonb
            WHERE question_id = $5 AND version_no = $6 AND language = 'EN'
        `, [finalLabel, source, user.id, JSON.stringify(historyEntry), question_id, version_no]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            question_id,
            version_no,
            final_correct_option_label: finalLabel,
            final_answer_source: source,
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('answer-conflicts resolve error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
