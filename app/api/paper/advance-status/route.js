import db from '@/lib/db';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-edge';

export async function POST(request) {
    const user = await getCurrentUser();

    // Only admins should be pushing paper status manually forward through the pipeline 
    // (except for Reviewers clicking complete on Bilingual, which was handled separately).
    if (!user || !user.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { paper_session_id, next_status } = body;

    if (!paper_session_id || !next_status) {
        return NextResponse.json({ error: 'Missing paper_session_id or next_status' }, { status: 400 });
    }

    const validStatuses = [
        'NOT_REVIEWED',
        'TEAM_REVIEWED',
        'ADMIN_REVIEWED',
        'MISSING_ADDED',
        'PRE_PUBLISH_READY',
        'SOLUTION_REVIEW',
        'PRODUCTION',
        'NOT_WORTHY'
    ];

    if (!validStatuses.includes(next_status)) {
        return NextResponse.json({ error: 'Invalid status provided' }, { status: 400 });
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        // IF Moving to PRE_PUBLISH_READY, we must enforce the exact question count
        if (next_status === 'PRE_PUBLISH_READY') {
            // 1. Get Exam Required Question Count
            const examConfigRes = await client.query(`
                SELECT e.num_questions 
                FROM paper_session ps
                JOIN exam e ON ps.exam_id = e.exam_id
                WHERE ps.paper_session_id = $1
            `, [paper_session_id]);

            if (examConfigRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'Paper or Exam context not found.' }, { status: 404 });
            }

            const targetQuestionCount = parseInt(examConfigRes.rows[0].num_questions, 10);
            if (!targetQuestionCount || targetQuestionCount <= 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'Exam configuration error: Target number of questions is not set correctly.' }, { status: 400 });
            }

            // 2. Get Actual Question Count in this paper session
            const actualCountRes = await client.query(`
                SELECT COUNT(*) as current_count
                FROM question_version
                WHERE paper_session_id = $1
            `, [paper_session_id]);

            const currentCount = parseInt(actualCountRes.rows[0].current_count, 10);

            if (currentCount !== targetQuestionCount) {
                await client.query('ROLLBACK');
                return NextResponse.json({
                    error: `Validation Failed: This exam requires exactly ${targetQuestionCount} questions, but this paper currently has ${currentCount}.`
                }, { status: 400 });
            }
        }

        // Get current status before changing it
        const currentRes = await client.query(
            `SELECT status FROM paper_session WHERE paper_session_id = $1`,
            [paper_session_id]
        );
        const prev_status = currentRes.rows[0]?.status ?? null;

        // Update status and append history entry
        await client.query(`
            UPDATE paper_session
            SET
                status = $1,
                status_history = COALESCE(status_history, '[]'::jsonb) || jsonb_build_object(
                    'from',       $3::text,
                    'to',         $1::text,
                    'changed_by', $4::int,
                    'at',         to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                )::jsonb
            WHERE paper_session_id = $2
        `, [next_status, paper_session_id, prev_status, user.id]);

        await client.query('COMMIT');
        return NextResponse.json({ success: true, new_status: next_status });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error advancing paper status:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    } finally {
        client.release();
    }
}
