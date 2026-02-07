import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const paper_session_id = searchParams.get('paper_id') || '9dd2fc0a-043b-49a4-94cb-e4e1fae412d9';

    const client = await db.connect();
    try {
        // Check for duplicate question_ids in question_version
        const duplicatesQuery = `
            SELECT 
                question_id, 
                COUNT(*) as count,
                array_agg(version_no) as versions,
                array_agg(language) as languages
            FROM question_version
            WHERE paper_session_id = $1
            GROUP BY question_id
            HAVING COUNT(*) > 1
            ORDER BY COUNT(*) DESC
        `;

        const duplicatesRes = await client.query(duplicatesQuery, [paper_session_id]);

        // Get total count
        const totalQuery = `
            SELECT COUNT(*) as total
            FROM question_version
            WHERE paper_session_id = $1
        `;
        const totalRes = await client.query(totalQuery, [paper_session_id]);

        // Get sample questions
        const sampleQuery = `
            SELECT question_id, version_no, language, source_question_no, body_json->>'text' as text
            FROM question_version
            WHERE paper_session_id = $1
            ORDER BY created_at
            LIMIT 10
        `;
        const sampleRes = await client.query(sampleQuery, [paper_session_id]);

        return NextResponse.json({
            paper_session_id,
            total_records: parseInt(totalRes.rows[0].total),
            duplicates_found: duplicatesRes.rows.length,
            duplicates: duplicatesRes.rows,
            sample_questions: sampleRes.rows
        });

    } catch (error) {
        console.error('Diagnostic error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
