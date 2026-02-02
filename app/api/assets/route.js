import db from '@/lib/db';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    const isDebug = searchParams.get('debug') === 'true';

    if (!name) {
        return NextResponse.json({ error: 'Name parameter required' }, { status: 400 });
    }

    try {
        const client = await db.connect();
        try {
            // Find asset by original name or local_path match
            const res = await client.query(`
                SELECT local_path, mime_type 
                FROM asset 
                WHERE local_path LIKE '%' || $1 || '%' OR original_name = $1
                LIMIT 1
            `, [name]);

            if (res.rows.length === 0) {
                return NextResponse.json({ error: 'Asset not found in database', name }, { status: 404 });
            }

            const { local_path, mime_type } = res.rows[0];

            // Cloudinary Mapping Logic
            const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dem3qcuju';

            // Check if local_path matches the specific Windows path we want to map
            // C:\Users\Neuraedge\Documents\Divya\MeritEdge\Code\adda_ssc\mathpix_raw_zips\ -> assets/
            // Note: We use simple string matching. 
            const localPrefix = 'C:\\Users\\Neuraedge\\Documents\\Divya\\MeritEdge\\Code\\adda_ssc\\mathpix_raw_zips\\';

            let finalUrl = null;
            let matchType = 'none';

            if (local_path && local_path.toLowerCase().startsWith(localPrefix.toLowerCase())) {
                const relativePath = local_path.substring(localPrefix.length).replace(/\\/g, '/');
                finalUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/assets/${relativePath}`;
                matchType = 'path_replacement';
            } else if (local_path && (local_path.startsWith('http://') || local_path.startsWith('https://'))) {
                finalUrl = local_path;
                matchType = 'direct_url';
            }

            if (isDebug) {
                return NextResponse.json({
                    debug: true,
                    name,
                    found_in_db: true,
                    local_path_in_db: local_path,
                    match_type: matchType,
                    local_prefix_configured: localPrefix,
                    generated_cloudinary_url: finalUrl,
                    would_redirect: !!finalUrl
                });
            }

            if (finalUrl) {
                return NextResponse.redirect(finalUrl, 302);
            }

            // Otherwise, serve from local filesystem
            if (!local_path || !fs.existsSync(local_path)) {
                return NextResponse.json({
                    error: 'File not found on disk',
                    path: local_path
                }, { status: 404 });
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
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}
