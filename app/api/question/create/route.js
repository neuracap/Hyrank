import { NextResponse } from 'next/server';
import db from '@/lib/db';
import crypto from 'crypto';

export async function POST(req) {
    const client = await db.connect();

    try {
        const body = await req.json();
        const { paper_session_id, section_name } = body;

        if (!paper_session_id) {
            return NextResponse.json({ error: 'Missing paper_session_id' }, { status: 400 });
        }

        // 1. Resolve Section ID (if name provided)
        let exam_section_id = null;
        if (section_name) {
            // Try to find section by code or name matching the provided string
            // We need to know the exam_id to be precise, but paper_session knows exam_id
            const secRes = await client.query(`
                SELECT s.section_id 
                FROM exam_section s
                JOIN paper_session ps ON s.exam_id = ps.exam_id
                WHERE ps.paper_session_id = $1 
                AND (LOWER(s.code) = LOWER($2) OR LOWER(s.name) = LOWER($2))
                LIMIT 1
            `, [paper_session_id, section_name]);

            if (secRes.rows.length > 0) {
                exam_section_id = secRes.rows[0].section_id;
            }
        }

        // 2. Determine Language
        // Check standard language of questions in this session
        const langRes = await client.query(`
            SELECT language, COUNT(*) as c
            FROM question_version
            WHERE paper_session_id = $1
            GROUP BY language
            ORDER BY c DESC
            LIMIT 1
        `, [paper_session_id]);

        const language = langRes.rows.length > 0 ? langRes.rows[0].language : 'EN';

        await client.query('BEGIN');

        // 3. Create Question (Parent)
        const questionId = crypto.randomUUID();
        await client.query(`INSERT INTO question (question_id) VALUES ($1)`, [questionId]);

        // 4. Create Question Version (Single Language)
        const initialText = language === 'HI' ? "नया प्रश्न - इसे संपादित करें" : "New Question - Edit this text";

        await client.query(`
            INSERT INTO question_version 
            (question_id, version_no, language, status, paper_session_id, exam_section_id, body_json, question_type, has_image, source_question_no)
            VALUES ($1, 1, $2, 'draft', $3, $4, $5, 'MCQ', false, 'Q.New')
        `, [questionId, language, paper_session_id, exam_section_id, { text: initialText }]);

        await client.query('COMMIT');

        return NextResponse.json({ success: true, questionId });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error creating question:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
