import db from '@/lib/db';
import { NextResponse } from 'next/server';

export async function POST(request) {
    const body = await request.json();
    const { paper_session_id } = body;

    if (!paper_session_id) {
        return NextResponse.json({ error: 'Missing paper_session_id' }, { status: 400 });
    }

    const client = await db.connect();

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

        // 3. Update ALL question_links for both sessions
        const updateResult = await client.query(`
            UPDATE question_links
            SET updated_score = 1.0,
                status = 'MANUALLY_CORRECTED'
            WHERE 
                ($1::uuid IS NOT NULL AND paper_session_id_english = $1)
                OR
                ($2::uuid IS NOT NULL AND paper_session_id_hindi = $2)
        `, [engSessionId, hinSessionId]);

        const updatedCount = updateResult.rowCount;

        // 4. Mark paper sessions as reviewed (if the field exists)
        // Try to update questions_reviewed field, but don't fail if it doesn't exist
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
        // Only if the table exists (it should now)
        await client.query(`
            UPDATE review_assignments
            SET status = 'COMPLETED'
            WHERE paper_session_id = ANY($1)
        `, [sessionIds]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            updatedCount,
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
