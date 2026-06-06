import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const VALID_LABELS = ['A', 'B', 'C', 'D'];

/**
 * POST /api/mock-test/[id]/hindi-review/edit
 *
 * Body: { question_id, version_no, stem?, options?: { A?, B?, C?, D? } }
 *
 * Patches the HI question_version + question_option rows. Validates the
 * question is part of this mock and that an HI version_no row exists
 * (translate-hindi creates it).
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id: mockTestId } = await params;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { question_id, version_no, stem, options } = body || {};
    if (!question_id || version_no == null) {
        return NextResponse.json({ error: 'question_id and version_no required' }, { status: 400 });
    }
    if (stem == null && (!options || Object.keys(options).length === 0)) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Belongs to this mock?
        const present = await client.query(
            `SELECT 1 FROM mock_test_question WHERE mock_test_id = $1 AND question_id = $2`,
            [mockTestId, question_id]
        );
        if (present.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Question not in this mock' }, { status: 404 });
        }

        // HI row exists?
        const hi = await client.query(
            `SELECT body_json FROM question_version
             WHERE question_id = $1 AND version_no = $2 AND language = 'HI'`,
            [question_id, version_no]
        );
        if (hi.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({
                error: 'HI version not found. Run Translate to Hindi first.',
            }, { status: 404 });
        }

        if (typeof stem === 'string') {
            const newBody = { ...(hi.rows[0].body_json || {}), text: stem };
            await client.query(`
                UPDATE question_version
                SET body_json = $1::jsonb, status = 'DRAFT', updated_at = NOW()
                WHERE question_id = $2 AND version_no = $3 AND language = 'HI'
            `, [JSON.stringify(newBody), question_id, version_no]);
        }
        if (options) {
            for (const k of VALID_LABELS) {
                if (typeof options[k] !== 'string') continue;
                const optRes = await client.query(
                    `SELECT option_json FROM question_option
                     WHERE question_id = $1 AND version_no = $2 AND language = 'HI' AND option_key = $3`,
                    [question_id, version_no, k]
                );
                const cur = optRes.rows[0]?.option_json || { format: 'mmd' };
                const next = { ...cur, text: options[k] };
                if (optRes.rows.length > 0) {
                    await client.query(`
                        UPDATE question_option
                        SET option_json = $1::jsonb
                        WHERE question_id = $2 AND version_no = $3 AND language = 'HI' AND option_key = $4
                    `, [JSON.stringify(next), question_id, version_no, k]);
                } else {
                    await client.query(`
                        INSERT INTO question_option
                          (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                        VALUES ($1, $2, 'HI', $3, $4::jsonb, false, NOW())
                    `, [question_id, version_no, k, JSON.stringify(next)]);
                }
            }
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('hindi-review/edit error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
