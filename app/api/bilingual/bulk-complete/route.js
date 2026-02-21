import db from '@/lib/db';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-edge';

export async function POST(request) {
    const body = await request.json();
    const { paper_session_id } = body;

    if (!paper_session_id) {
        return NextResponse.json({ error: 'Missing paper_session_id' }, { status: 400 });
    }

    const client = await db.connect();

    // Get current user for assignment
    const user = await getCurrentUser();
    const reviewerId = user ? user.id : 1; // Fallback to 1 if no user context somehow

    try {
        await client.query('BEGIN');

        // 1. Determine if this session is English or Hindi
        const sessionLangRes = await client.query(`
            SELECT language FROM paper_session WHERE paper_session_id = $1
        `, [paper_session_id]);

        if (sessionLangRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
        }

        const sessionLanguage = sessionLangRes.rows[0].language;
        const isEnglishSession = sessionLanguage === 'EN';

        // 2. Find the paired session ID
        let engSessionId = null;
        let hinSessionId = null;

        if (isEnglishSession) {
            engSessionId = paper_session_id;
            // Find Hindi session
            const hinLinkRes = await client.query(`
                SELECT paper_session_id_hindi 
                FROM question_links 
                WHERE paper_session_id_english = $1 
                LIMIT 1
            `, [paper_session_id]);

            if (hinLinkRes.rows.length > 0 && hinLinkRes.rows[0].paper_session_id_hindi) {
                hinSessionId = hinLinkRes.rows[0].paper_session_id_hindi;
            }
        } else {
            hinSessionId = paper_session_id;
            // Find English session
            const engLinkRes = await client.query(`
                SELECT paper_session_id_english 
                FROM question_links 
                WHERE paper_session_id_hindi = $1 
                LIMIT 1
            `, [paper_session_id]);

            if (engLinkRes.rows.length > 0 && engLinkRes.rows[0].paper_session_id_english) {
                engSessionId = engLinkRes.rows[0].paper_session_id_english;
            }
        }

        // 3. Mark paper sessions as reviewed 
        const sessionIds = [engSessionId, hinSessionId].filter(id => id !== null);

        for (const sessionId of sessionIds) {
            // First check if the column exists
            const columnCheckRes = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'paper_session' 
                AND column_name = 'questions_reviewed'
            `);

            if (columnCheckRes.rows.length > 0) {
                // Column exists, update it
                await client.query(`
                    UPDATE paper_session
                    SET questions_reviewed = true,
                        updated_at = NOW()
                    WHERE paper_session_id = $1
                `, [sessionId]);
            }
        }

        // 5. Update review_assignments status to COMPLETED
        // Upsert just in case the assignment wasn't formally created before completion
        for (const sessionId of sessionIds) {
            await client.query(`
                INSERT INTO review_assignments (paper_session_id, reviewer_id, status)
                VALUES ($1, $2, 'COMPLETED')
                ON CONFLICT (paper_session_id) 
                DO UPDATE SET status = 'COMPLETED', assigned_at = NOW()
            `, [sessionId, reviewerId]);
        }

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            engSessionId,
            hinSessionId
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Bulk complete error:', error);
        return NextResponse.json({
            error: 'Failed to complete bulk update',
            details: error.message
        }, { status: 500 });
    } finally {
        client.release();
    }
}
