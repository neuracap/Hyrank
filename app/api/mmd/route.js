import db from '@/lib/db';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
        return NextResponse.json({ error: 'id parameter required' }, { status: 400 });
    }

    try {
        const result = await db.query(
            'SELECT full_text, file_path FROM raw_mmd_doc WHERE raw_mmd_doc_id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        }

        const { full_text, file_path } = result.rows[0];
        const filename = file_path ? file_path.split(/[/\\]/).pop() : 'document.mmd';

        // Return as a styled HTML page for readable viewing
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${filename}</title>
    <style>
        body {
            font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Monaco', monospace;
            max-width: 900px;
            margin: 0 auto;
            padding: 2rem;
            background: #fafafa;
            color: #1a1a1a;
            line-height: 1.6;
            font-size: 13px;
        }
        h1 {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 1rem;
            color: #666;
            border-bottom: 1px solid #ddd;
            padding-bottom: 0.5rem;
            margin-bottom: 1.5rem;
        }
        pre {
            white-space: pre-wrap;
            word-wrap: break-word;
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 6px;
            padding: 1.5rem;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <h1>${filename}</h1>
    <pre>${full_text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>`;

        return new NextResponse(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    } catch (e) {
        console.error('MMD doc fetch error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
