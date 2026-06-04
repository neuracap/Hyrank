import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { CA_SUBTYPES } from '@/lib/cgl-mock-spec';

export const dynamic = 'force-dynamic';

const VALID_LABELS = ['A', 'B', 'C', 'D'];

/**
 * POST /api/current-affairs/[id]/edit
 *
 * Body: any subset of:
 *   { stem, options: { A?, B?, C?, D? }, correct_option_label,
 *     ca_subtype, relevance_year, relevance_quarter, difficulty,
 *     headline, category }
 *
 * Patches the mcq_json + the top-level columns. Only allowed while status='NEW'.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    if (body.ca_subtype && !CA_SUBTYPES.includes(body.ca_subtype)) {
        return NextResponse.json({ error: `Invalid ca_subtype. Allowed: ${CA_SUBTYPES.join(', ')}` }, { status: 400 });
    }
    if (body.correct_option_label && !VALID_LABELS.includes(body.correct_option_label)) {
        return NextResponse.json({ error: 'correct_option_label must be A/B/C/D' }, { status: 400 });
    }
    if (body.relevance_year != null) {
        const y = parseInt(body.relevance_year, 10);
        if (!Number.isInteger(y) || y < 2000 || y > 2100) {
            return NextResponse.json({ error: 'relevance_year invalid' }, { status: 400 });
        }
    }
    if (body.relevance_quarter != null) {
        const q = parseInt(body.relevance_quarter, 10);
        if (!Number.isInteger(q) || q < 1 || q > 4) {
            return NextResponse.json({ error: 'relevance_quarter must be 1-4' }, { status: 400 });
        }
    }
    if (body.difficulty != null) {
        const d = parseInt(body.difficulty, 10);
        if (!Number.isInteger(d) || d < 1 || d > 4) {
            return NextResponse.json({ error: 'difficulty must be 1-4' }, { status: 400 });
        }
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const curRes = await client.query(
            `SELECT id, status, mcq_json FROM current_affairs WHERE id = $1 FOR UPDATE`,
            [id]
        );
        if (curRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const cur = curRes.rows[0];
        if (cur.status !== 'NEW') {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: `Cannot edit a ${cur.status} CA — only NEW is editable` }, { status: 409 });
        }

        // Build the patched mcq_json
        const mcq = { ...(cur.mcq_json || {}) };
        if (typeof body.stem === 'string') mcq.stem = body.stem;
        if (body.options && typeof body.options === 'object') {
            mcq.options = { ...(mcq.options || {}) };
            for (const k of VALID_LABELS) {
                if (typeof body.options[k] === 'string') mcq.options[k] = body.options[k];
            }
        }
        if (body.correct_option_label) mcq.correct_option_label = body.correct_option_label;

        // Top-level patches
        const sets = ['mcq_json = $1'];
        const vals = [JSON.stringify(mcq)];
        const addSet = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
        if (typeof body.headline === 'string') addSet('headline', body.headline);
        if (typeof body.category === 'string') addSet('category', body.category);
        if (typeof body.ca_subtype === 'string') addSet('ca_subtype', body.ca_subtype);
        if (body.relevance_year != null) addSet('relevance_year', parseInt(body.relevance_year, 10));
        if (body.relevance_quarter != null) addSet('relevance_quarter', parseInt(body.relevance_quarter, 10));
        if (body.difficulty != null) addSet('difficulty', parseInt(body.difficulty, 10));

        vals.push(id);
        await client.query(
            `UPDATE current_affairs SET ${sets.join(', ')} WHERE id = $${vals.length}`,
            vals
        );
        await client.query('COMMIT');
        return NextResponse.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('current-affairs/edit error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
