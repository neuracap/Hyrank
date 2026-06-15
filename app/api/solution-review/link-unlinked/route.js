import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { canAccessSolutionReview } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * POST /api/solution-review/link-unlinked
 *
 * Links one or more standalone EN/HI question_version rows that share a
 * paper pair. Each pair is only linked when BOTH sides are currently
 * unlinked for the given paper_session_id pair — never silently rewires
 * an established link.
 *
 * Body:
 *   {
 *     en_session_id: uuid,
 *     hi_session_id: uuid,
 *     pairs: [
 *       { english_question_id, english_version_no, hindi_question_id, hindi_version_no }
 *     ]
 *   }
 *
 * Returns: { success, linked, skipped, skipped_pairs: [...] }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!canAccessSolutionReview(user)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { en_session_id, hi_session_id, pairs } = body || {};
    if (!en_session_id || !hi_session_id) {
        return NextResponse.json({ error: 'en_session_id and hi_session_id are required' }, { status: 400 });
    }
    if (!Array.isArray(pairs) || pairs.length === 0) {
        return NextResponse.json({ error: 'pairs[] is required and must not be empty' }, { status: 400 });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        let linked = 0;
        const skipped = [];

        for (const p of pairs) {
            const enQid = p.english_question_id;
            const enVno = p.english_version_no || 1;
            const hiQid = p.hindi_question_id;
            const hiVno = p.hindi_version_no || 1;
            if (!enQid || !hiQid) {
                skipped.push({ ...p, reason: 'missing_ids' });
                continue;
            }

            // Verify both sides exist in the right paper_sessions.
            const enRes = await client.query(`
                SELECT 1 FROM question_version
                WHERE question_id = $1 AND version_no = $2 AND language = 'EN' AND paper_session_id = $3
            `, [enQid, enVno, en_session_id]);
            const hiRes = await client.query(`
                SELECT 1 FROM question_version
                WHERE question_id = $1 AND version_no = $2 AND language = 'HI' AND paper_session_id = $3
            `, [hiQid, hiVno, hi_session_id]);
            if (enRes.rows.length === 0 || hiRes.rows.length === 0) {
                skipped.push({ ...p, reason: 'side_not_in_session' });
                continue;
            }

            // Both sides must be unlinked for THIS paper pair.
            const conflict = await client.query(`
                SELECT 1 FROM question_links
                WHERE (english_question_id = $1 AND paper_session_id_english = $3)
                   OR (hindi_question_id   = $2 AND paper_session_id_hindi   = $4)
                LIMIT 1
            `, [enQid, hiQid, en_session_id, hi_session_id]);
            if (conflict.rows.length > 0) {
                skipped.push({ ...p, reason: 'already_linked' });
                continue;
            }

            await client.query(`
                INSERT INTO question_links
                (english_question_id, english_version_no, english_language,
                 hindi_question_id, hindi_version_no, hindi_language,
                 paper_session_id_english, paper_session_id_hindi,
                 similarity_score, updated_score, status, created_at)
                VALUES ($1, $2, 'EN', $3, $4, 'HI', $5, $6, 1.0, 1.0, 'MANUALLY_CORRECTED', NOW())
            `, [enQid, enVno, hiQid, hiVno, en_session_id, hi_session_id]);
            linked += 1;
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true, linked, skipped: skipped.length, skipped_pairs: skipped });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('solution-review/link-unlinked error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
