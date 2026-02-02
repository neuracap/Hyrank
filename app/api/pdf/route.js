import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import mime from 'mime';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
        return NextResponse.json({ error: 'Path is required' }, { status: 400 });
    }

    // Security check: Ensure we are only serving PDFs and potentially restricted to certain directories if needed.
    // For now, assuming internal tool usage, we focus on serving the file.

    // Normalize path for Windows
    const normalizedPath = path.normalize(filePath);

    if (!fs.existsSync(normalizedPath)) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    try {
        const fileBuffer = fs.readFileSync(normalizedPath);
        const stats = fs.statSync(normalizedPath);

        // Get MIME type
        const mimeType = mime.getType(normalizedPath) || 'application/pdf';

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': mimeType,
                'Content-Length': stats.size.toString(),
                'Content-Disposition': `inline; filename="${path.basename(normalizedPath)}"`
            }
        });
    } catch (e) {
        console.error("Error serving PDF:", e);
        return NextResponse.json({ error: 'Error serving file' }, { status: 500 });
    }
}
