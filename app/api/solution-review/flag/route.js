import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export async function POST(request) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { question_id, version_no, flag, note } = body;
    if (!question_id || version_no == null) {
        return NextResponse.json({ error: 'question_id and version_no are required' }, { status: 400 });
    }

    try {
        if (flag) {
            // Flag the question — set status to FLAGGED and store note in solution_json
            await db.query(`
                UPDATE question_version
                SET status = 'FLAGGED',
                    solution_json = COALESCE(solution_json, '{}'::jsonb) || jsonb_build_object(
                        'flag_note', $1::text,
                        'flagged_by', $2::int,
                        'flagged_at', NOW()::text
                    ),
                    updated_at = NOW()
                WHERE question_id = $3 AND version_no = $4
            `, [note || '', user.id, question_id, version_no]);
        } else {
            // Unflag — revert status to DRAFT and remove flag fields
            await db.query(`
                UPDATE question_version
                SET status = 'DRAFT',
                    solution_json = COALESCE(solution_json, '{}'::jsonb) - 'flag_note' - 'flagged_by' - 'flagged_at',
                    updated_at = NOW()
                WHERE question_id = $1 AND version_no = $2
            `, [question_id, version_no]);
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error('Solution review flag error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
