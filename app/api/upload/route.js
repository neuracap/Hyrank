import { NextResponse } from 'next/server';
import db from '@/lib/db';
import crypto from 'crypto';
import { v2 as cloudinary } from 'cloudinary';

export const dynamic = 'force-dynamic';

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

export async function POST(request) {
    const client = await db.connect();
    try {
        let fileBuffer;
        let mimeType;
        let originalName;
        let questionId, language, role, optionKey, versionNo;

        const contentType = request.headers.get('content-type') || '';

        // Parsing logic (Multipart / JSON)
        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            const file = formData.get('file');

            questionId = formData.get('question_id');
            language = formData.get('language');
            role = formData.get('role');
            optionKey = formData.get('option_key');
            versionNo = formData.get('version_no');

            if (!file) {
                return NextResponse.json({ error: 'No file provided' }, { status: 400 });
            }

            fileBuffer = Buffer.from(await file.arrayBuffer());
            mimeType = file.type;
            originalName = file.name;

        } else if (contentType.includes('application/json')) {
            const body = await request.json();
            const dataUrl = body.data;

            questionId = body.question_id;
            language = body.language;
            role = body.role;
            optionKey = body.option_key;
            versionNo = body.version_no;

            if (!dataUrl) {
                return NextResponse.json({ error: 'No data URL provided' }, { status: 400 });
            }

            const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches.length !== 3) {
                return NextResponse.json({ error: 'Invalid data URL' }, { status: 400 });
            }

            mimeType = matches[1];
            fileBuffer = Buffer.from(matches[2], 'base64');
            originalName = 'image.png';
        } else {
            return NextResponse.json({ error: 'Unsupported Content-Type' }, { status: 400 });
        }

        if (!questionId || !language) {
            return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
        }

        // 1. Determine Cloudinary Folder Path
        const pathRes = await client.query(`
            SELECT ps.session_label, e.name as exam_name
            FROM question_version qv
            JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
            JOIN exam e ON ps.exam_id = e.exam_id
            WHERE qv.question_id = $1 AND qv.language = $2
            LIMIT 1
        `, [questionId, language]);

        let folderPath = 'assets/uploads'; // Fallback

        if (pathRes.rows.length > 0) {
            const { session_label, exam_name } = pathRes.rows[0];
            const sanitize = (str) => str.replace(/[<>:"/\\|?*]/g, '-').trim().replace(/\s+/g, '-').toLowerCase();

            const examSlug = sanitize(exam_name);
            const sessionSlug = sanitize(session_label);

            folderPath = `assets/${examSlug}/${sessionSlug}`;
        }

        // 2. Upload to Cloudinary
        // Convert buffer to data URI for easy upload
        const base64Data = fileBuffer.toString('base64');
        const dataURI = `data:${mimeType};base64,${base64Data}`;

        const uploadResult = await cloudinary.uploader.upload(dataURI, {
            folder: folderPath,
            resource_type: 'image',
            use_filename: true,
            unique_filename: true
        });

        // uploadResult.secure_url is the full URL
        const secureUrl = uploadResult.secure_url;

        // 3. Generate Asset ID and Insert into DB
        const assetId = crypto.randomUUID();

        await client.query(`
            INSERT INTO asset (asset_id, original_name, local_path, mime_type, bytes, created_at, asset_type)
            VALUES ($1, $2, $3, $4, $5, NOW(), 'image')
        `, [assetId, originalName || 'upload.png', secureUrl, mimeType, fileBuffer.length]);

        // 4. Insert into Map
        if (role && optionKey && versionNo) {
            await client.query(`
                INSERT INTO question_asset_map (question_id, asset_id, role, option_key, version_no, language)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [questionId, assetId, role, optionKey, versionNo, language]);
        }

        // 5. Return Response
        // Return full Cloudinary URL as latexPath so frontend renders it directly
        return NextResponse.json({
            success: true,
            latexPath: secureUrl,
            assetId: assetId
        });

    } catch (e) {
        console.error("Upload error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
