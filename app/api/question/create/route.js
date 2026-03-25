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

        // 1. Resolve Section ID, code, and name (if name provided)
        let exam_section_id = null;
        let sectionCode = null;
        let sectionName = null;
        if (section_name) {
            const secRes = await client.query(`
                SELECT s.section_id, s.code, s.name
                FROM exam_section s
                JOIN paper_session ps ON s.exam_id = ps.exam_id
                WHERE ps.paper_session_id = $1
                AND (LOWER(s.code) = LOWER($2) OR LOWER(s.name) = LOWER($2))
                LIMIT 1
            `, [paper_session_id, section_name]);

            if (secRes.rows.length > 0) {
                exam_section_id = secRes.rows[0].section_id;
                sectionCode = secRes.rows[0].code;
                sectionName = secRes.rows[0].name;
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
        await client.query(`INSERT INTO question (question_id, created_at) VALUES ($1, NOW())`, [questionId]);

        // 4. Create Question Version (Single Language)
        const initialText = language === 'HI' ? "नया प्रश्न - इसे संपादित करें" : "New Question - Edit this text";

        const metaJson = {
            source: 'manual',
            ...(sectionCode && { section_code: sectionCode }),
            ...(sectionName && { section_name: sectionName })
        };

        await client.query(`
            INSERT INTO question_version
            (question_id, version_no, language, status, paper_session_id, exam_section_id, body_json, question_type, has_image, source_question_no, meta_json, created_at, updated_at)
            VALUES ($1, 1, $2, 'draft', $3, $4, $5, 'MCQ', false, 'Q.New', $6, NOW(), NOW())
        `, [questionId, language, paper_session_id, exam_section_id, { text: initialText }, metaJson]);

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
