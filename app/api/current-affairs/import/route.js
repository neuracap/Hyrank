import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/current-affairs/import
 *
 * Body: { items: [...], year, quarter, source?, source_url? }
 *
 * Each item in `items` must have:
 *   { question: string, options: { A, B, C, D }, answer: 'A'|'B'|'C'|'D' }
 * Optionally: { id, headline, summary, category }
 *
 * Inserts NEW rows into current_affairs with the batch's year/quarter applied
 * to each. Reviewer assigns ca_subtype + final year/quarter during review.
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
        return NextResponse.json({ error: 'items array required' }, { status: 400 });
    }
    const year = parseInt(body.year, 10);
    const quarter = parseInt(body.quarter, 10);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return NextResponse.json({ error: 'year must be a 4-digit number' }, { status: 400 });
    }
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
        return NextResponse.json({ error: 'quarter must be 1, 2, 3, or 4' }, { status: 400 });
    }
    const sourceTag = body.source || null;
    const sourceUrl = body.source_url || null;

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const inserted = [];
        const errors = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const question = (item.question || '').trim();
            const options = item.options || {};
            const answer = (item.answer || '').toUpperCase();
            if (!question || !['A', 'B', 'C', 'D'].every(k => options[k])
                || !['A', 'B', 'C', 'D'].includes(answer)) {
                errors.push({ index: i, source_id: item.id, reason: 'malformed item (need question, options A-D, answer)' });
                continue;
            }
            const mcqJson = {
                stem: question,
                options: { A: options.A, B: options.B, C: options.C, D: options.D },
                correct_option_label: answer,
                source_id: item.id ?? null,
            };
            const res = await client.query(`
                INSERT INTO current_affairs
                  (headline, summary, source, source_url, published_at, category,
                   mcq_json, status, relevance_year, relevance_quarter, difficulty,
                   created_at)
                VALUES ($1, $2, $3, $4, NULL, $5, $6, 'NEW', $7, $8, 2, NOW())
                RETURNING id
            `, [
                item.headline || question.slice(0, 200),
                item.summary || null,
                sourceTag,
                sourceUrl,
                item.category || null,
                JSON.stringify(mcqJson),
                year,
                quarter,
            ]);
            inserted.push(res.rows[0].id);
        }
        await client.query('COMMIT');
        return NextResponse.json({
            success: true,
            inserted_count: inserted.length,
            inserted_ids: inserted,
            skipped: errors,
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('current-affairs/import error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
