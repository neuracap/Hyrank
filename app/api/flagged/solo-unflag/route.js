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

    const { question_id, version_no, language } = body;
    if (!question_id || version_no == null) {
        return NextResponse.json({ error: 'question_id and version_no are required' }, { status: 400 });
    }

    try {
        await db.query(`
            UPDATE question_version SET status = 'MANUALLY_CORRECTED', updated_at = NOW()
            WHERE question_id = $1 AND version_no = $2 AND language = $3
        `, [question_id, version_no, language || 'EN']);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('flagged/solo-unflag error:', error);
        return NextResponse.json({ error: 'Failed to unflag', details: error.message }, { status: 500 });
    }
}
