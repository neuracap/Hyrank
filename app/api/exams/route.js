import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export async function GET() {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const examsRes = await db.query(`
            SELECT exam_id, name, num_questions
            FROM exam
            ORDER BY name ASC
        `);

        const sectionsRes = await db.query(`
            SELECT section_id, exam_id, code, name, sort_order
            FROM exam_section
            ORDER BY exam_id, sort_order ASC NULLS LAST, name ASC
        `);

        // Group sections by exam_id
        const sectionsByExam = {};
        for (const s of sectionsRes.rows) {
            if (!sectionsByExam[s.exam_id]) sectionsByExam[s.exam_id] = [];
            sectionsByExam[s.exam_id].push(s);
        }

        const exams = examsRes.rows.map(e => ({
            ...e,
            sections: sectionsByExam[e.exam_id] || []
        }));

        return NextResponse.json({ exams });
    } catch (e) {
        console.error('Error fetching exams:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
