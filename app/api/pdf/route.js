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

            // Construct folder and filename for Search API
            // relativePath is like "ssc-cgl/File Name.pdf"
            // Cloudinary folder: "pdfs/ssc-cgl"

            const parts = relativePath.split('/');
            const filenameWithExt = parts.pop(); // "File Name.pdf"
            const subfolder = parts.join('/'); // "ssc-cgl"

            const folderName = subfolder ? `pdfs/${subfolder}` : 'pdfs';
            const filename = filenameWithExt.replace(/\.pdf$/i, ''); // "File Name"

            console.log("Cloudinary Search:", { folderName, filename, relativePath });

            // Search API is more robust than guessing Public IDs
            // It allows us to find the asset even if Cloudinary sanitized spaces to _ or -
            try {
                // Construct the expected public_id prefix
                // e.g. "pdfs/ssc-cgl/SSC-CGL-Tier-1-Question-Paper-English_25.09.2024_12.30-PM-01.30-PM"
                const publicIdPrefix = `${folderName}/${filename}`;

                // Escape special characters for the search expression if needed
                // But usually public_id search handles standard chars well.
                // We'll use the starts_with operator logic via wildcard

                console.log("Searching for public_id prefix:", publicIdPrefix);

                const searchRes = await cloudinary.search
                    .expression(`resource_type:image AND public_id:"${publicIdPrefix}*"`)
                    .sort_by('created_at', 'desc')
                    .max_results(1)
                    .execute();

                if (searchRes.resources && searchRes.resources.length > 0) {
                    const pdfUrl = searchRes.resources[0].secure_url;
                    console.log("Found PDF via search (exact):", pdfUrl);

                    // Proxy the content
                    const pdfRes = await fetch(pdfUrl);
                    if (!pdfRes.ok) {
                        throw new Error(`Failed to fetch PDF from Cloudinary: ${pdfRes.statusText}`);
                    }
                    const pdfBuffer = await pdfRes.arrayBuffer();

                    return new NextResponse(pdfBuffer, {
                        headers: {
                            'Content-Type': 'application/pdf',
                            'Content-Disposition': `inline; filename="${filename}.pdf"`,
                            'Content-Length': pdfBuffer.byteLength.toString(),
                            // Optional: Cache control
                            'Cache-Control': 'public, max-age=3600'
                        }
                    });
                }

                // If not found, try searching with loose filename (maybe special chars differ)
                // Note: filenames in search might be strict.
                console.log("PDF not found via exact name search. Trying manual fallback.");

            } catch (searchError) {
                console.error("Cloudinary search failed:", searchError);
            }

            // Fallback to the constructed URL if search fails (legacy behavior)
            const fallbackPath = `pdfs/${relativePath.replace(/\\/g, '/')}`; // pdfs/ssc-cgl/file.pdf

            // Try formatting spaces to hyphens just in case
            const hyphenPath = fallbackPath.replace(/ /g, '-');

            const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dem3qcuju';
            const fallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${hyphenPath}`;

            console.log("Trying fallback URL:", fallbackUrl);

            // Proxy the fallback logic as well
            try {
                const fallbackRes = await fetch(fallbackUrl);
                if (fallbackRes.ok) {
                    const pdfBuffer = await fallbackRes.arrayBuffer();
                    return new NextResponse(pdfBuffer, {
                        headers: {
                            'Content-Type': 'application/pdf',
                            'Content-Disposition': `inline; filename="${path.basename(normalizedPath)}"`,
                            'Content-Length': pdfBuffer.byteLength.toString(),
                            'Cache-Control': 'public, max-age=3600'
                        }
                    });
                }
            } catch (fallbackError) {
                console.error("Fallback proxy failed:", fallbackError);
            }

            console.log("Fallback failed. Redirecting as last resort.");
            return NextResponse.redirect(fallbackUrl, 302);

        } catch (e) {
            console.error("Cloudinary error:", e);
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
