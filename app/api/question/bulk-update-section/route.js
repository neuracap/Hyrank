import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function POST(req) {
    const client = await db.connect();
    try {
        const { question_ids, section_id, section_name, paper_session_id } = await req.json();

        if (!question_ids || !Array.isArray(question_ids) || question_ids.length === 0 || !section_id) {
            return NextResponse.json({ error: 'Missing required fields or invalid question_ids' }, { status: 400 });
        }

        await client.query('BEGIN');

        // Fetch current meta_json for all questions to preserve other fields
        // However, updating jsonb fields in bulk with different existing values is tricky in a single UPDATE if we want to merge.
        // But postgres jsonb_set can work if we assume we just want to set one key.

        // Strategy: 
        // 1. Update exam_section_id directly.
        // 2. Update meta_json->'section_name' using jsonb_set. 
        //    (If meta_json is null, COALESCE to {}).

        await client.query(`
            UPDATE question_version
            SET 
                exam_section_id = $1,
                meta_json = jsonb_set(COALESCE(meta_json, '{}'::jsonb), '{section_name}', to_jsonb($2::text))
            WHERE question_id = ANY($3)
        `, [section_id, section_name || '', question_ids]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            message: `Successfully moved ${question_ids.length} questions to ${section_name}`
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error bulk updating section:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
