import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

export async function GET() {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const res = await db.query(`
            SELECT channel_id, platform, channel_name, channel_identifier, is_active, created_at
            FROM social_channel ORDER BY created_at DESC
        `);
        return NextResponse.json({ channels: res.rows });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
