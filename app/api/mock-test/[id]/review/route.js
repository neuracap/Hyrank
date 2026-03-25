import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

/**
 * POST /api/mock-test/[id]/review
 * Approve or reject questions in a mock test.
 * Body: { reviews: [{ question_id, action: 'approve'|'reject', rejection_note? }] }
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { reviews } = await req.json();

    if (!reviews || !Array.isArray(reviews) || reviews.length === 0) {
        return NextResponse.json({ error: 'reviews array is required' }, { status: 400 });
    }

    const client = await db.connect();

    try {
        // Verify mock exists and is in reviewable state
        const mockRes = await client.query(
            `SELECT status FROM mock_test WHERE mock_test_id = $1`, [id]
        );
        if (mockRes.rows.length === 0) {
            client.release();
            return NextResponse.json({ error: 'Mock test not found' }, { status: 404 });
        }

        const mockStatus = mockRes.rows[0].status;
        if (!['DRAFT', 'IN_REVIEW'].includes(mockStatus)) {
            client.release();
            return NextResponse.json({ error: `Cannot review mock in ${mockStatus} status` }, { status: 400 });
        }

        await client.query('BEGIN');

        // Move mock to IN_REVIEW if still DRAFT
        if (mockStatus === 'DRAFT') {
            await client.query(
                `UPDATE mock_test SET status = 'IN_REVIEW', updated_at = NOW() WHERE mock_test_id = $1`,
                [id]
            );
        }

        let approvedCount = 0;
        let rejectedCount = 0;

        for (const review of reviews) {
            const { question_id, action, rejection_note } = review;
            if (!question_id || !['approve', 'reject'].includes(action)) continue;

            if (action === 'approve') {
                await client.query(`
                    UPDATE mock_test_question
                    SET review_status = 'APPROVED',
                        reviewed_by = $1, reviewed_at = NOW(),
                        rejection_note = NULL
                    WHERE mock_test_id = $2 AND question_id = $3
                `, [user.id, id, question_id]);
                approvedCount++;
            } else {
                await client.query(`
                    UPDATE mock_test_question
                    SET review_status = 'REJECTED',
                        reviewed_by = $1, reviewed_at = NOW(),
                        rejection_note = $2
                    WHERE mock_test_id = $3 AND question_id = $4
                `, [user.id, rejection_note || null, id, question_id]);
                rejectedCount++;
            }
        }

        // Check if all questions are approved
        const statusCheck = await client.query(`
            SELECT review_status, COUNT(*) AS cnt
            FROM mock_test_question
            WHERE mock_test_id = $1
            GROUP BY review_status
        `, [id]);

        const statusMap = {};
        for (const r of statusCheck.rows) statusMap[r.review_status] = parseInt(r.cnt);
        const allApproved = !statusMap['PENDING'] && !statusMap['REJECTED'];

        if (allApproved) {
            await client.query(
                `UPDATE mock_test SET status = 'APPROVED', updated_at = NOW() WHERE mock_test_id = $1`,
                [id]
            );
        }

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            approved: approvedCount,
            rejected: rejectedCount,
            mock_status: allApproved ? 'APPROVED' : 'IN_REVIEW',
            review_summary: statusMap,
        });

    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('mock-test/review error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
