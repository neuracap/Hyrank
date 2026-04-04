import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '50');

    try {
        const res = await db.query(`
            SELECT sp.*, sc.channel_name, sc.platform
            FROM social_post sp
            LEFT JOIN social_channel sc ON sc.channel_id = sp.channel_id
            ORDER BY sp.created_at DESC
            LIMIT $1
        `, [limit]);
        return NextResponse.json({ posts: res.rows });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
