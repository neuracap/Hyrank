import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

/**
 * POST /api/mock-test/blueprint/save
 * Create or update a blueprint.
 * Body: { blueprint_id?, exam_id, name, config_json }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { blueprint_id, exam_id, name, config_json } = await req.json();
    if (!exam_id || !name || !config_json) {
        return NextResponse.json({ error: 'exam_id, name, and config_json are required' }, { status: 400 });
    }

    try {
        if (blueprint_id) {
            // Update existing
            await db.query(`
                UPDATE mock_blueprint
                SET name = $1, config_json = $2, updated_at = NOW()
                WHERE blueprint_id = $3
            `, [name, JSON.stringify(config_json), blueprint_id]);

            return NextResponse.json({ success: true, blueprint_id });
        } else {
            // Create new
            const res = await db.query(`
                INSERT INTO mock_blueprint (exam_id, name, config_json, created_at, updated_at)
                VALUES ($1, $2, $3, NOW(), NOW())
                RETURNING blueprint_id
            `, [exam_id, name, JSON.stringify(config_json)]);

            return NextResponse.json({ success: true, blueprint_id: res.rows[0].blueprint_id });
        }
    } catch (e) {
        console.error('mock-test/blueprint/save error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
