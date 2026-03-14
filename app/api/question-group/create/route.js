import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { group_type, passage_en, passage_hi, exam_section_id } = await req.json();

        const result = await db.query(`
            INSERT INTO question_group (group_type, passage_en, passage_hi, exam_section_id, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING group_id
        `, [
            group_type || 'RC',
            passage_en || '',
            passage_hi || '',
            exam_section_id || null
        ]);

        return NextResponse.json({
            success: true,
            group_id: result.rows[0].group_id
        });
    } catch (e) {
        console.error('Error creating question group:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
