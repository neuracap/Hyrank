import db from '@/lib/db';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');

    if (!name) {
        return NextResponse.json({ error: 'Name parameter required' }, { status: 400 });
    }

    try {
        const client = await db.connect();
        try {
            // Find asset by original name (lazy matching as path string might contain full path)
            // The markdown has ./images/filename. We just want to match filename if possible or the full path stored.
            // Inspection showed `local_path` in asset table. 
            // We search where original_name matches or some other logic. 
            // Inspection of raw_asset might be better but let's try asset table first as per plan.
            // The plan said `original_name LIKE '%' || name`.

            const res = await client.query(`
                SELECT local_path, mime_type 
                FROM asset 
                WHERE local_path LIKE '%' || $1 || '%' OR original_name = $1
                LIMIT 1
            `, [name]);

            if (res.rows.length === 0) {
                return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
            }

            const { local_path, mime_type } = res.rows[0];

            if (!local_path || !fs.existsSync(local_path)) {
                return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
            }

            const fileBuffer = fs.readFileSync(local_path);

            return new NextResponse(fileBuffer, {
                headers: {
                    'Content-Type': mime_type || 'application/octet-stream',
                    'Content-Length': fileBuffer.length,
                },
            });

        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Asset error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
