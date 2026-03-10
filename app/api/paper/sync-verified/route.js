import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let client;
    try {
        client = await db.connect();

        // Set is_verified = TRUE on question_version rows that are linked
        // to a question_links record with status = 'MANUALLY_CORRECTED'.
        // Both the English and Hindi question_version rows are updated.
        const result = await client.query(`
            UPDATE question_version qv
            SET is_verified = TRUE
            FROM question_links ql
            WHERE ql.status = 'MANUALLY_CORRECTED'
              AND (
                (ql.english_question_id = qv.question_id AND ql.english_version_no = qv.version_no)
                OR
                (ql.hindi_question_id   = qv.question_id AND ql.hindi_version_no   = qv.version_no)
              )
        `);

        return NextResponse.json({
            success: true,
            updated: result.rowCount
        });

    } catch (error) {
        console.error('Sync verified error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
