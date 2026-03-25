import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function getBatchStatus(batchName) {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${batchName}?key=${GEMINI_API_KEY}`,
        { method: 'GET' }
    );
    if (!res.ok) {
        const errText = await res.text();
        return { name: batchName, state: 'FETCH_ERROR', error: errText };
    }
    return await res.json();
}

function normalizeState(state) {
    if (!state) return '';
    const s = String(state);
    return s.includes('.') ? s.split('.').pop().trim().toUpperCase() : s.trim().toUpperCase();
}

export async function GET() {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!GEMINI_API_KEY) {
        return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    try {
        // Find all distinct batch names that have submitted questions
        const result = await db.query(`
            SELECT
                meta_json->>'solution_batch_name' AS batch_name,
                COUNT(*) AS question_count,
                MIN(updated_at) AS submitted_at
            FROM question_version
            WHERE solution_status = 'BATCH_SUBMITTED'
              AND meta_json->>'solution_batch_name' IS NOT NULL
            GROUP BY meta_json->>'solution_batch_name'
            ORDER BY MIN(updated_at) DESC
        `);

        if (result.rows.length === 0) {
            return NextResponse.json({ batches: [] });
        }

        // Check status of each batch via Gemini API
        const batches = [];
        for (const row of result.rows) {
            const batchName = row.batch_name;
            const geminiStatus = await getBatchStatus(batchName);
            const state = normalizeState(geminiStatus.state);

            batches.push({
                batch_name: batchName,
                state,
                question_count: parseInt(row.question_count),
                submitted_at: row.submitted_at,
                output_file: geminiStatus.dest?.file_name
                    || geminiStatus.output_config?.file_name
                    || null,
                error: geminiStatus.error || null,
            });
        }

        return NextResponse.json({ batches });
    } catch (e) {
        console.error('solution-batch/status error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
