import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { generateSectionTest, SectionTestError } from '@/lib/section-test-generator';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/section-test/create
 * Body: { exam_id, section_code }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { exam_id, section_code, difficulty_level } = await req.json();
    if (!exam_id || !section_code || !difficulty_level) {
        return NextResponse.json({ error: 'exam_id, section_code, and difficulty_level are required' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        const result = await generateSectionTest(client, {
            exam_id, section_code, difficulty_level, user_id: user.id,
        });
        return NextResponse.json({ success: true, ...result });
    } catch (e) {
        if (e instanceof SectionTestError) {
            return NextResponse.json(
                { error: e.message, pool_size: e.pool_size },
                { status: e.status }
            );
        }
        console.error('section-test/create error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
