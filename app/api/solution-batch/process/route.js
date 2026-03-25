import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { parseCompositeKey } from '@/lib/solution-prompts';
import { parseSolutionResponse, normalizeOptionLabel } from '@/lib/solution-parser';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// =========================================================
// Gemini REST helpers
// =========================================================
async function getBatchStatus(batchName) {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${batchName}?key=${GEMINI_API_KEY}`,
        { method: 'GET' }
    );
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini batch status failed (${res.status}): ${errText}`);
    }
    return await res.json();
}

function normalizeState(state) {
    if (!state) return '';
    const s = String(state);
    return s.includes('.') ? s.split('.').pop().trim().toUpperCase() : s.trim().toUpperCase();
}

async function downloadResults(fileName) {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${GEMINI_API_KEY}`,
        { method: 'GET' }
    );
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini result download failed (${res.status}): ${errText}`);
    }
    return await res.text();
}

// =========================================================
// DB update helpers
// =========================================================
async function updateSolutionInDb(client, questionId, versionNo, language, parsed) {
    const solutionJson = JSON.stringify(parsed.fullJson);

    await client.query(`
        UPDATE question_version SET
            solution_json = $1::jsonb,
            subtype = NULLIF($2, ''),
            correct_option_label = NULLIF($3, ''),
            final_answer_text = NULLIF($4, ''),
            recheck_options = $5,
            solution_status = 'DONE',
            solution_generated_at = NOW(),
            solution_figure_helpful = $6,
            solution_figure_prompt = NULLIF($7, ''),
            difficulty = $8,
            updated_at = NOW()
        WHERE question_id = $9 AND version_no = $10 AND language = $11
    `, [
        solutionJson,
        parsed.subtype || '',
        parsed.correctOptionLabel || '',
        parsed.finalAnswerText || '',
        parsed.recheckOptions || false,
        parsed.figureHelpful || false,
        parsed.figurePrompt || '',
        parsed.difficultySmallint,
        questionId,
        versionNo,
        language,
    ]);

    // Update is_correct on question_option for correct answer
    if (parsed.correctOptionLabel) {
        // Update for the same language
        await client.query(`
            UPDATE question_option
            SET is_correct = (option_key = $1)
            WHERE question_id = $2 AND language = $3
        `, [parsed.correctOptionLabel, questionId, language]);
    }
}

async function markFailedInDb(client, questionId, versionNo, language, errorText) {
    await client.query(`
        UPDATE question_version
        SET solution_status = 'FAILED',
            meta_json = COALESCE(meta_json, '{}'::jsonb)
                || jsonb_build_object('solution_error', $1::text),
            updated_at = NOW()
        WHERE question_id = $2 AND version_no = $3 AND language = $4
    `, [String(errorText).slice(0, 3000), questionId, versionNo, language]);
}

// =========================================================
// Process a single completed batch
// =========================================================
async function processOneBatch(batchName, client) {
    // 1. Get batch status and find output file
    const batchInfo = await getBatchStatus(batchName);
    const state = normalizeState(batchInfo.state);

    if (state !== 'JOB_STATE_SUCCEEDED') {
        // If failed/cancelled, mark all questions as FAILED
        if (['JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED'].includes(state)) {
            await client.query(`
                UPDATE question_version
                SET solution_status = 'FAILED',
                    meta_json = COALESCE(meta_json, '{}'::jsonb)
                        || jsonb_build_object('solution_error', $1::text),
                    updated_at = NOW()
                WHERE solution_status = 'BATCH_SUBMITTED'
                  AND meta_json->>'solution_batch_name' = $2
            `, [`Batch ended in state: ${state}`, batchName]);

            return { batch_name: batchName, state, processed: 0, failed: 0, errors: [`Batch ${state}`] };
        }

        return { batch_name: batchName, state, processed: 0, failed: 0, errors: [`Batch not yet complete: ${state}`] };
    }

    // 2. Find the output file
    const outputFile = batchInfo.dest?.file_name
        || batchInfo.output_config?.file_name
        || batchInfo.dest?.file
        || null;

    // Also check nested structures
    let resolvedFile = outputFile;
    if (!resolvedFile && batchInfo.output) {
        resolvedFile = batchInfo.output.file_name || batchInfo.output.file;
    }

    if (!resolvedFile) {
        return { batch_name: batchName, state, processed: 0, failed: 0, errors: ['Could not find output file in batch response'] };
    }

    // 3. Download results
    const rawText = await downloadResults(resolvedFile);
    const rawLines = rawText.split('\n').filter(l => l.trim());

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // 4. Process each result line
    for (const line of rawLines) {
        let row;
        try {
            row = JSON.parse(line);
        } catch (e) {
            errors.push(`JSONL parse error: ${e.message}`);
            errorCount++;
            continue;
        }

        const key = row.key || '';
        let questionId, versionNo, language;

        try {
            ({ questionId, versionNo, language } = parseCompositeKey(key));
        } catch {
            errors.push(`Invalid key: ${key}`);
            errorCount++;
            continue;
        }

        try {
            // Check for Gemini-level errors
            const statusBlock = row.status;
            if (statusBlock && statusBlock.code != null && statusBlock.code !== 200) {
                const msg = statusBlock.message || 'Gemini result error';
                await markFailedInDb(client, questionId, versionNo, language, msg);
                errors.push(`${key}: ${msg}`);
                errorCount++;
                continue;
            }

            const responseBlock = row.response;
            if (!responseBlock) {
                await markFailedInDb(client, questionId, versionNo, language, 'Missing response block');
                errors.push(`${key}: Missing response block`);
                errorCount++;
                continue;
            }

            // Extract text from response
            const responseText = responseBlock.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!responseText) {
                await markFailedInDb(client, questionId, versionNo, language, 'Empty response text');
                errors.push(`${key}: Empty response text`);
                errorCount++;
                continue;
            }

            // Detect section from parsed JSON for language check
            let tempData;
            try {
                tempData = JSON.parse(responseText);
            } catch {
                const cleaned = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                tempData = JSON.parse(cleaned);
            }
            const section = (tempData.question_identity || {}).section || '';

            // Parse the full response
            const parsed = parseSolutionResponse(responseText, language, section);

            if (!parsed.success) {
                await markFailedInDb(client, questionId, versionNo, language, parsed.error);
                errors.push(`${key}: ${parsed.error}`);
                errorCount++;
                continue;
            }

            // Update DB with solution
            await updateSolutionInDb(client, questionId, versionNo, language, parsed.data);
            successCount++;

        } catch (e) {
            await markFailedInDb(client, questionId, versionNo, language, e.message).catch(() => {});
            errors.push(`${key}: ${e.message}`);
            errorCount++;
        }
    }

    return { batch_name: batchName, state, processed: successCount, failed: errorCount, errors: errors.slice(0, 50) };
}

// =========================================================
// Route handler
// =========================================================
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!GEMINI_API_KEY) {
        return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    let body = {};
    try {
        body = await req.json();
    } catch {
        // No body is OK — process all completed batches
    }

    const { batch_name } = body;

    const client = await db.connect();

    try {
        let batchNames = [];

        if (batch_name) {
            batchNames = [batch_name];
        } else {
            // Find all submitted batch names
            const result = await client.query(`
                SELECT DISTINCT meta_json->>'solution_batch_name' AS batch_name
                FROM question_version
                WHERE solution_status = 'BATCH_SUBMITTED'
                  AND meta_json->>'solution_batch_name' IS NOT NULL
            `);
            batchNames = result.rows.map(r => r.batch_name);
        }

        if (batchNames.length === 0) {
            return NextResponse.json({ success: true, message: 'No submitted batches to process', results: [] });
        }

        const results = [];
        let totalProcessed = 0;
        let totalFailed = 0;

        for (const bn of batchNames) {
            await client.query('BEGIN');
            try {
                const result = await processOneBatch(bn, client);
                await client.query('COMMIT');
                results.push(result);
                totalProcessed += result.processed;
                totalFailed += result.failed;
            } catch (e) {
                await client.query('ROLLBACK');
                console.error(`solution-batch/process error for ${bn}:`, e);
                results.push({ batch_name: bn, state: 'PROCESS_ERROR', processed: 0, failed: 0, errors: [e.message] });
            }
        }

        return NextResponse.json({
            success: true,
            total_processed: totalProcessed,
            total_failed: totalFailed,
            batches_checked: batchNames.length,
            results,
        });

    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('solution-batch/process error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
