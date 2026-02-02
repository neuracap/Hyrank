import db from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    try {
        const stmt = db.prepare(`
            SELECT 
                id, q_no, exam, question_text, difficulty, subject, topic, final_answer_label 
            FROM questions 
            ORDER BY id ASC 
            LIMIT ? OFFSET ?
        `);
        const questions = stmt.all(limit, offset);

        const countStmt = db.prepare('SELECT COUNT(*) as total FROM questions');
        const total = countStmt.get().total;

        return NextResponse.json({
            data: questions,
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Database error:', error);
        return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 });
    }
}
