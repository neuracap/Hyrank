import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { buildPrompt, buildJsonlLine, compositeKey, getSectionKey } from '@/lib/solution-prompts';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_BATCH_MODEL || 'gemini-2.5-flash';
const BATCH_SIZE = 100;

// =========================================================
// Gemini REST helpers
// =========================================================
async function uploadJsonl(jsonlContent, displayName) {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/jsonl',
                'X-Goog-Upload-Protocol': 'raw',
                'X-Goog-Upload-Header-Content-Type': 'application/jsonl',
            },
            body: jsonlContent,
        }
    );
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini file upload failed (${res.status}): ${errText}`);
    }
    const data = await res.json();
    return data.file?.name || data.name;
}

async function createBatch(fileName, displayName) {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:batchGenerateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                batch: {
                    display_name: displayName,
                    input_config: { file_name: fileName },
                },
            }),
        }
    );
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini batch create failed (${res.status}): ${errText}`);
    }
    return await res.json();
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

    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { paper_session_id } = body;
    if (!paper_session_id) {
        return NextResponse.json({ error: 'paper_session_id is required' }, { status: 400 });
    }

    const client = await db.connect();

    try {
        // 1. Fetch eligible questions
        const qRes = await client.query(`
            SELECT
                qv.question_id,
                qv.version_no,
                qv.language,
                qv.body_json,
                qv.exam_section_id,
                es.code AS section_code
            FROM question_version qv
            LEFT JOIN exam_section es ON es.section_id = qv.exam_section_id
            WHERE qv.paper_session_id = $1
              AND qv.status = 'MANUALLY_CORRECTED'
              AND qv.has_image = false
              AND COALESCE(qv.solution_status, 'pending') IN ('pending', 'FAILED')
              AND NOT EXISTS (
                  SELECT 1 FROM question_option qo
                  WHERE qo.question_id = qv.question_id
                    AND (qo.option_json::text ILIKE '%![](%%' OR qo.option_json::text ILIKE '%./images/%')
              )
            ORDER BY qv.question_number_int NULLS LAST, qv.created_at
        `, [paper_session_id]);

        const questions = qRes.rows;
        if (questions.length === 0) {
            client.release();
            return NextResponse.json({ error: 'No eligible questions found' }, { status: 404 });
        }

        // 2. Fetch options for all question_ids
        const questionIds = [...new Set(questions.map(q => q.question_id))];
        const optRes = await client.query(`
            SELECT question_id, version_no, language, option_key, option_json->>'text' AS opt_text
            FROM question_option
            WHERE question_id = ANY($1)
            ORDER BY question_id, language, option_key
        `, [questionIds]);

        // Group options by question_id|version_no|language
        const optionsMap = {};
        for (const o of optRes.rows) {
            const k = `${o.question_id}|${o.version_no}|${o.language}`;
            if (!optionsMap[k]) optionsMap[k] = [];
            optionsMap[k].push({ option_key: o.option_key, text: o.opt_text || '' });
        }

        // 3. Build JSONL lines
        const lines = [];
        let skipped = 0;

        for (const q of questions) {
            const sectionKey = getSectionKey(q.section_code);
            if (!sectionKey) {
                skipped++;
                continue;
            }

            const questionStem = JSON.stringify(q.body_json);
            const optKey = `${q.question_id}|${q.version_no}|${q.language}`;
            const opts = optionsMap[optKey] || [];
            const optionsStr = JSON.stringify(opts);

            const prompt = buildPrompt(q.section_code, q.question_id, questionStem, optionsStr, q.language);
            if (!prompt) {
                skipped++;
                continue;
            }

            const key = compositeKey(q.question_id, q.version_no, q.language);
            lines.push({
                jsonlLine: buildJsonlLine(key, prompt),
                questionId: q.question_id,
                versionNo: q.version_no,
                language: q.language,
                section: sectionKey,
            });
        }

        if (lines.length === 0) {
            client.release();
            return NextResponse.json({ error: 'No questions could be mapped to sections', skipped }, { status: 400 });
        }

        // 4. Split into batches and submit
        const batches = [];
        const chunks = [];
        for (let i = 0; i < lines.length; i += BATCH_SIZE) {
            chunks.push(lines.slice(i, i + BATCH_SIZE));
        }

        for (let idx = 0; idx < chunks.length; idx++) {
            const chunk = chunks[idx];
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const displayName = `hyrank-solutions-${stamp}-${idx + 1}`;

            // Build JSONL content
            const jsonlContent = chunk.map(c => c.jsonlLine).join('\n');

            // Upload JSONL to Gemini Files API
            const fileName = await uploadJsonl(jsonlContent, displayName);

            // Create batch job
            const batchJob = await createBatch(fileName, displayName);
            const batchName = batchJob.name;

            // Mark questions as BATCH_SUBMITTED in DB
            await client.query('BEGIN');
            for (const item of chunk) {
                await client.query(`
                    UPDATE question_version
                    SET solution_status = 'BATCH_SUBMITTED',
                        meta_json = COALESCE(meta_json, '{}'::jsonb)
                            || jsonb_build_object(
                                'solution_batch_name', $1::text,
                                'solution_batch_file', $2::text,
                                'solution_section', $3::text
                            ),
                        updated_at = NOW()
                    WHERE question_id = $4 AND version_no = $5 AND language = $6
                `, [batchName, fileName, item.section, item.questionId, item.versionNo, item.language]);
            }
            await client.query('COMMIT');

            batches.push({
                batch_name: batchName,
                file_name: fileName,
                question_count: chunk.length,
            });
        }

        return NextResponse.json({
            success: true,
            batches,
            skipped,
            total_submitted: lines.length,
        });

    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('solution-batch/submit error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
