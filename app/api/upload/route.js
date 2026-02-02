import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import db from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(request) {
    const client = await db.connect();
    try {
        let fileBuffer;
        let mimeType;
        let originalName;
        let questionId, language, role, optionKey, versionNo;

        const contentType = request.headers.get('content-type') || '';

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
            const dataUrl = body.data; // data:image/png;base64,...

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
            originalName = 'image.png'; // Default for base64 paste
        } else {
            return NextResponse.json({ error: 'Unsupported Content-Type' }, { status: 400 });
        }

        if (!questionId || !language) {
            return NextResponse.json({ error: 'Missing metadata (question_id, language)' }, { status: 400 });
        }

        // 1. Determine Folder Path
        // We need to look up the exam and session for this question
        const pathRes = await client.query(`
            SELECT ps.session_label, e.name as exam_name
            FROM question_version qv
            JOIN paper_session ps ON qv.paper_session_id = ps.paper_session_id
            JOIN exam e ON ps.exam_id = e.exam_id
            WHERE qv.question_id = $1 AND qv.language = $2
            LIMIT 1
        `, [questionId, language]);

        if (pathRes.rows.length === 0) {
            return NextResponse.json({ error: 'Question not found' }, { status: 404 });
        }

        const { session_label, exam_name } = pathRes.rows[0];

        // Base directory from user configuration
        const baseDir = 'C:\\Users\\Neuraedge\\Documents\\Divya\\MeritEdge\\Code\\adda_ssc\\mathpix_raw_zips';

        // Normalize names for folders
        // Sanitize for Windows paths (remove < > : " / \ | ? *)
        const sanitize = (str) => str.replace(/[<>:"/\\|?*]/g, '-').trim();

        const examSlug = sanitize(exam_name.toLowerCase().replace(/\s+/g, '-'));
        const examDir = path.join(baseDir, examSlug);

        let sessionDirName = sanitize(session_label);
        let imagesDir = path.join(examDir, sessionDirName, 'images');

        // FUZZY MATCHING: Check if a directory exists that matches the session label ignoring special chars
        // This handles cases like ":" mapping to "." (04:00 -> 04.00) vs "-" (04:00 -> 04-00)
        // AND handles cases where DB label has prefixes like "Unlimited Re-Attempt [ACTUAL-ID]"
        if (fs.existsSync(examDir)) {
            try {
                const subdirs = fs.readdirSync(examDir); // List all sessions
                // Normalize function: keep alphanumeric only, lowercase
                const normalize = (s) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                const target = normalize(session_label);

                // Sort directories by length descending to match most specific/longest directory first (avoid vague short matches)
                const sortedDirs = subdirs.sort((a, b) => b.length - a.length);

                let foundDir = null;

                // Strategy 1: Exact Normalized Match
                foundDir = sortedDirs.find(d => normalize(d) === target);

                // Strategy 2: Bracket content matching (Extract [ID] from label and look for it in dirs)
                // Label: "Unlimited Re-Attempt [SSC-CGL-Tier-1...]" -> Match: "SSC-CGL-Tier-1..."
                if (!foundDir) {
                    const bracketMatch = session_label.match(/\[(.*?)\]/);
                    if (bracketMatch && bracketMatch[1]) {
                        const bracketContent = normalize(bracketMatch[1]);
                        if (bracketContent.length > 5) { // Avoid short IDs like [1]
                            foundDir = sortedDirs.find(d => normalize(d).includes(bracketContent));
                        }
                    }
                }

                // Strategy 3: Directory is a substring of the Label (e.g. Label="Prefix [DirName]")
                if (!foundDir) {
                    foundDir = sortedDirs.find(d => {
                        const normD = normalize(d);
                        return normD.length > 8 && target.includes(normD);
                    });
                }

                // Strategy 4: Label is a substring of the Directory (e.g. Dir="Prefix [Label]")
                if (!foundDir) {
                    foundDir = sortedDirs.find(d => {
                        const normD = normalize(d);
                        return normalize(d).includes(target);
                    });
                }

                if (foundDir) {
                    sessionDirName = foundDir;
                    imagesDir = path.join(examDir, sessionDirName, 'images');
                }
            } catch (e) {
                console.error("Error scanning directories for fuzzy match:", e);
            }
        }

        if (!fs.existsSync(imagesDir)) {
            // Attempt to create, but warn if parent doesn't exist
            try {
                fs.mkdirSync(imagesDir, { recursive: true });
            } catch (e) {
                console.error("Failed to create dir:", imagesDir, e);
                // Try a fallback to a simpler temp dir if main fails?
                // For now, duplicate error log to verify path 
                console.error(`Base: ${baseDir}, Exam: ${examSlug}, Session: ${session_label} -> Parsed: ${sessionDirName}`);
                return NextResponse.json({ error: 'Failed to find or create asset directory: ' + e.message }, { status: 500 });
            }
        }

        // 2. Save File
        // Generate UUID filename
        const assetId = crypto.randomUUID();
        const ext = mimeType === 'image/jpeg' ? '.jpg' : '.png';
        const filename = `${assetId}${ext}`;
        const localPath = path.join(imagesDir, filename);

        fs.writeFileSync(localPath, fileBuffer);

        // 3. Insert into Asset Table
        await client.query(`
            INSERT INTO asset (asset_id, original_name, local_path, mime_type, bytes, created_at, asset_type)
            VALUES ($1, $2, $3, $4, $5, NOW(), 'image')
        `, [assetId, originalName, localPath, mimeType, fileBuffer.length]);

        // 4. Insert into Question_Asset_Map (if role provided)
        if (role && optionKey && versionNo) {
            await client.query(`
                INSERT INTO question_asset_map (question_id, asset_id, role, option_key, version_no, language)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [questionId, assetId, role, optionKey, versionNo, language]);
        }

        return NextResponse.json({
            success: true,
            latexPath: `./images/${filename}`,
            assetId: assetId
        });

    } catch (e) {
        console.error("Upload error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
