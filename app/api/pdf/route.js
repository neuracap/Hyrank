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

    // Cloudinary Mapping Logic
    const localPrefix = 'C:\\Users\\Neuraedge\\Documents\\Divya\\MeritEdge\\Code\\adda_ssc\\process_mathpix\\';

    if (normalizedPath && normalizedPath.toLowerCase().startsWith(localPrefix.toLowerCase())) {
        const relativePath = normalizedPath.substring(localPrefix.length).replace(/\\/g, '/');

        // Try to find the resource in Cloudinary
        try {
            // Configure Cloudinary (ensure environment variables are set)
            const { v2: cloudinary } = await import('cloudinary');
            cloudinary.config({
                cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
                api_key: process.env.CLOUDINARY_API_KEY,
                api_secret: process.env.CLOUDINARY_API_SECRET,
                secure: true,
            });

            // Construct Public ID possibilities
            // 1. With extension (as is)
            // 2. Without extension (strip last .pdf)
            // 3. Sanitized filename (spaces to underscores/hyphens?) -> Let's try exact first.

            // Note: DB relativePath might be "ssc-cgl/File Name.pdf"
            // Cloudinary might be "pdfs/ssc-cgl/File-Name" or "pdfs/ssc-cgl/File_Name"

            const folderPrefix = 'pdfs/';
            const originalPath = folderPrefix + relativePath; // "pdfs/ssc-cgl/file.pdf"

            // Attempt 1: Check exact path as public_id (some uploads keep extension in ID)
            // But usually public_id does NOT have extension.

            const pathWithoutExt = originalPath.replace(/\.pdf$/i, '');

            // We want to deliver it. 
            // If the user's link 404s, it's likely the public ID is wrong.
            // Let's try to find it.

            // Function to check resource
            const getUrl = async (publicId) => {
                try {
                    const res = await cloudinary.api.resource(publicId, { resource_type: 'image' }); // PDFs are 'image' usually
                    return res.secure_url;
                } catch (e) {
                    // Try raw
                    try {
                        const res = await cloudinary.api.resource(publicId, { resource_type: 'raw' });
                        return res.secure_url;
                    } catch (e2) {
                        return null;
                    }
                }
            };

            // Try different variants of Public ID
            // 1. Exact relative path (sans extension)
            // 2. Sanitized? (spaces to _)
            // 3. Sanitized? (spaces to -)

            const candidates = [
                pathWithoutExt, // pdfs/ssc-cgl/file
                originalPath,   // pdfs/ssc-cgl/file.pdf (rare but possible)
                pathWithoutExt.replace(/ /g, '_'),
                pathWithoutExt.replace(/ /g, '-')
            ];

            for (const pid of candidates) {
                const url = await getUrl(pid);
                if (url) {
                    return NextResponse.redirect(url, 302);
                }
            }

            // If API fails or file not found in check, fallback to the manual construction 
            // but maybe try to be smarter or just return 404?
            // Fallback: The original manual URL logic, but maybe point to "image/upload" with sanitization
            // Let's keep the manual fallback closely matching what was there but sanitized.

            const fallbackUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME || 'dem3qcuju'}/image/upload/${originalPath}`;
            return NextResponse.redirect(fallbackUrl, 302);

        } catch (e) {
            console.error("Cloudinary lookup error:", e);
            // Fallback if SDK fails
            const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dem3qcuju';
            const cloudinaryUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/pdfs/${relativePath}`;
            return NextResponse.redirect(cloudinaryUrl, 302);
        }
    }

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
