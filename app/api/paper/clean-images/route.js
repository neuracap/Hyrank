import db from '@/lib/db';
import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Helper to Create Grayscale Copy
async function createGrayscaleCopy(sourcePath, destPath) {
    try {
        if (!fs.existsSync(sourcePath)) {
            console.warn(`File not found: ${sourcePath}`);
            return false;
        }

        const buffer = await sharp(sourcePath)
            .grayscale()
            .toBuffer();

        fs.writeFileSync(destPath, buffer);
        console.log(`Created grayscale copy: ${destPath}`);
        return true;
    } catch (e) {
        console.error(`Failed to convert ${sourcePath}:`, e);
        return false;
    }
}

async function resolveLocalPath(client, urlOrMarkdown) {
    let filename = null;

    if (urlOrMarkdown.includes('/images/')) {
        filename = urlOrMarkdown.split('/images/').pop().split(')')[0];
    } else if (urlOrMarkdown.includes('name=')) {
        filename = urlOrMarkdown.split('name=').pop().split('&')[0];
    }

    if (filename) filename = filename.split('?')[0];
    if (!filename) return null;

    filename = filename.replace(/\)$/, ''); // cleanup

    const res = await client.query(`
        SELECT asset_id, local_path, mime_type, original_name 
        FROM asset 
        WHERE local_path LIKE '%' || $1 || '%' OR original_name = $1 
        LIMIT 1
    `, [filename]);

    if (res.rows.length > 0) return res.rows[0];
    return null;
}

export async function POST(request) {
    const { paper_session_id } = await request.json();

    if (!paper_session_id) {
        return NextResponse.json({ error: 'Missing paper_session_id' }, { status: 400 });
    }

    const client = await db.connect();
    let stats = { processed: 0, imagesMoved: 0, grayscaleConverted: 0 };

    try {
        await client.query('BEGIN');

        // 1. Fetch all questions
        const qRes = await client.query(`
            SELECT question_id, language, body_json, source_question_no, version_no
            FROM question_version
            WHERE paper_session_id = $1
        `, [paper_session_id]);

        const questions = qRes.rows;

        for (const q of questions) {
            let text = q.body_json?.text || '';
            if (!text) continue;

            const imgRegex = /(!\[.*?\]\(.*?\))|(\\includegraphics\{.*?\})/g;
            const matches = text.match(imgRegex);

            if (matches && matches.length > 1) {
                console.log(`Processing Q.${q.source_question_no} (${q.question_id}): found ${matches.length} images`);
                stats.processed++;

                const otherImages = matches.slice(1); // These go to options
                let newText = text;
                for (const imgTag of otherImages) {
                    newText = newText.replace(imgTag, '').trim();
                }

                // Update Question Text (remove moved images)
                await client.query(`
                    UPDATE question_version 
                    SET body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text))
                    WHERE question_id = $2
                `, [newText, q.question_id]);

                // Options Logic
                const optionLabels = ['A', 'B', 'C', 'D'];
                const optRes = await client.query(`
                    SELECT option_key, option_json 
                    FROM question_option 
                    WHERE question_id = $1 AND language = $2
                    ORDER BY option_key ASC
                `, [q.question_id, q.language]);

                const dbOpts = optRes.rows;

                for (let i = 0; i < otherImages.length; i++) {
                    if (i >= optionLabels.length) break;

                    const imgTag = otherImages[i];
                    const label = optionLabels[i];

                    // Process Image: Create _gs variant
                    let newImgTag = imgTag;

                    const assetInfo = await resolveLocalPath(client, imgTag);
                    if (assetInfo) {
                        const sourcePath = assetInfo.local_path;
                        const parsed = path.parse(sourcePath);
                        const newFilename = `${parsed.name}_gs${parsed.ext}`;
                        const destPath = path.join(parsed.dir, newFilename);

                        // Create Grayscale File
                        const success = await createGrayscaleCopy(sourcePath, destPath);

                        if (success) {
                            stats.grayscaleConverted++;
                            // Insert into Asset Table
                            await client.query(`
                                INSERT INTO asset (
                                    asset_id, local_path, original_name, mime_type, 
                                    asset_type, created_at
                                ) VALUES (
                                    $1, $2, $3, $4, 'image', NOW()
                                )
                            `, [crypto.randomUUID(), destPath, newFilename, assetInfo.mime_type || 'image/jpeg']);

                            // Construct new tag
                            // Usually: ![](/images/filename)
                            // We construct: ![](/images/filename_gs.ext)
                            if (imgTag.startsWith('![')) {
                                // naive replacement of filename
                                // assuming link format is strict
                                const oldName = parsed.base; // filename.jpg
                                newImgTag = imgTag.replace(oldName, newFilename);
                            } else {
                                // latex
                                const oldName = parsed.base;
                                newImgTag = imgTag.replace(oldName, newFilename);
                            }
                        }
                    }

                    // Assign to Option
                    let targetOpt = dbOpts.find(o => o.option_key === label);

                    if (targetOpt) {
                        const oldOptText = targetOpt.option_json?.text || '';
                        const newOptText = `${oldOptText} ${newImgTag}`.trim();

                        await client.query(`
                            UPDATE question_option 
                            SET option_json = jsonb_set(option_json, '{text}', to_jsonb($1::text))
                            WHERE question_id = $2 AND language = $3 AND option_key = $4
                        `, [newOptText, q.question_id, q.language, label]);
                    } else {
                        const version = q.version_no || 1;
                        await client.query(`
                            INSERT INTO question_option (
                                question_id, version_no, language, option_key, option_json, is_correct, created_at
                            ) VALUES (
                                $1, $2, $3, $4, $5, false, NOW()
                            )
                        `, [q.question_id, version, q.language, label, { text: newImgTag, format: 'mmd' }]);
                    }
                    stats.imagesMoved++;
                }
            } else {
                // Single Image Case or just grayscale check
                if (matches) {
                    for (const imgTag of matches) {
                        const assetInfo = await resolveLocalPath(client, imgTag);
                        if (assetInfo) {
                            // Simply converting in place? OR creating _gs?
                            // User requirement: "saved in same folder and that new name is put in the options"
                            // For question text images, if we rename, we must update question text.

                            // Let's do _gs for safety and update link.
                            const sourcePath = assetInfo.local_path;
                            const parsed = path.parse(sourcePath);

                            // Skip if already _gs
                            if (parsed.name.endsWith('_gs')) continue;

                            const newFilename = `${parsed.name}_gs${parsed.ext}`;
                            const destPath = path.join(parsed.dir, newFilename);

                            const success = await createGrayscaleCopy(sourcePath, destPath);
                            if (success) {
                                stats.grayscaleConverted++;
                                await client.query(`
                                    INSERT INTO asset (asset_id, local_path, original_name, mime_type, asset_type, created_at)
                                    VALUES ($1, $2, $3, $4, 'image', NOW())
                                 `, [crypto.randomUUID(), destPath, newFilename, assetInfo.mime_type]);

                                // Replace in text
                                // Be careful with simple replace if multiple same images
                                const oldName = parsed.base;
                                const newText = text.replace(oldName, newFilename);
                                text = newText; // update local var for next loop?

                                await client.query(`
                                    UPDATE question_version
                                    SET body_json = jsonb_set(body_json, '{text}', to_jsonb($1::text))
                                    WHERE question_id = $2
                                 `, [newText, q.question_id]);
                            }
                        }
                    }
                }

                // Check Options too
                const optRes = await client.query(`
                    SELECT option_key, option_json FROM question_option 
                    WHERE question_id = $1 AND language = $2
                `, [q.question_id, q.language]);

                for (const opt of optRes.rows) {
                    let optText = opt.option_json?.text || '';
                    const optMatches = optText.match(imgRegex);
                    if (optMatches) {
                        for (const imgTag of optMatches) {
                            const assetInfo = await resolveLocalPath(client, imgTag);
                            if (assetInfo) {
                                const sourcePath = assetInfo.local_path;
                                const parsed = path.parse(sourcePath);
                                if (parsed.name.endsWith('_gs')) continue;

                                const newFilename = `${parsed.name}_gs${parsed.ext}`;
                                const destPath = path.join(parsed.dir, newFilename);

                                const success = await createGrayscaleCopy(sourcePath, destPath);
                                if (success) {
                                    stats.grayscaleConverted++;
                                    await client.query(`
                                        INSERT INTO asset (asset_id, local_path, original_name, mime_type, asset_type, created_at)
                                        VALUES ($1, $2, $3, $4, 'image', NOW())
                                    `, [crypto.randomUUID(), destPath, newFilename, assetInfo.mime_type]);

                                    const oldName = parsed.base;
                                    const newOptText = optText.replace(oldName, newFilename);
                                    optText = newOptText;

                                    await client.query(`
                                        UPDATE question_option
                                        SET option_json = jsonb_set(option_json, '{text}', to_jsonb($1::text))
                                        WHERE question_id = $2 AND language = $3 AND option_key = $4
                                    `, [newOptText, q.question_id, q.language, opt.option_key]);
                                }
                            }
                        }
                    }
                }
            }
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true, stats });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Clean Images Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
