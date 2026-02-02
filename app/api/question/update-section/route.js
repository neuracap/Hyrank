import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function POST(req) {
    const client = await db.connect();
    try {
        const { question_id, section_id, section_name, paper_session_id } = await req.json();

        if (!question_id || !section_id || !section_name) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Optional: Validate that section_id belongs to the exam of the paper_session
        // For speed, we might skip strict validation if we assume the frontend sends valid data
        // derived from the paper's exam sections.

        // Update the question
        // 1. Update exam_section_id
        // 2. Update meta_json->section_name (maintain other meta_json fields)

        await client.query('BEGIN');

        // Fetch current meta_json
        const currentRes = await client.query(
            'SELECT meta_json FROM question_version WHERE question_id = $1',
            [question_id]
        );

        if (currentRes.rows.length === 0) {
            throw new Error('Question not found');
        }

        const currentMeta = currentRes.rows[0].meta_json || {};
        // Ensure we are saving what the frontend sends, which should be the CODE
        const newMeta = { ...currentMeta, section_name: section_name };

        await client.query(`
            UPDATE question_version 
            SET 
                exam_section_id = $1,
                meta_json = $2
            WHERE question_id = $3
        `, [section_id, newMeta, question_id]);

        await client.query('COMMIT');

        return NextResponse.json({ success: true, message: 'Section updated successfully' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating section:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
