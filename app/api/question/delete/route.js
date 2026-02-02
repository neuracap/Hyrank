import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function POST(req) {
    const client = await db.connect();

    try {
        const body = await req.json();
        const { question_id } = body;

        if (!question_id) {
            return NextResponse.json({ error: 'Missing question_id' }, { status: 400 });
        }

        await client.query('BEGIN');

        // 1. Delete Options (Cascading usually handles this if FKs are set, but safer to be explicit)
        await client.query(`DELETE FROM question_option WHERE question_id = $1`, [question_id]);

        // 2. Delete Versions
        await client.query(`DELETE FROM question_version WHERE question_id = $1`, [question_id]);

        // 3. Delete Question (Parent)
        await client.query(`DELETE FROM question WHERE question_id = $1`, [question_id]);

        await client.query('COMMIT');

        return NextResponse.json({ success: true });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error deleting question:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
