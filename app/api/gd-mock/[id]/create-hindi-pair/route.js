import { NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { getSpecByExamId } from '@/lib/mock-spec-resolver';
import { pickHindiSection } from '@/lib/gd-hindi-picker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/gd-mock/[id]/create-hindi-pair
 *
 * Stage 3 of the GD bilingual workflow. Given an approved EN GD mock whose
 * REASONING / GA / QUANT questions have been translated (stage 2), creates
 * the paired Hindi-medium mock:
 *
 *   - 60 mock_test_question rows mirroring REAS/GA/QUANT — each points to
 *     the HI sibling question_id resolved via question_links.
 *   - 20 new mock_test_question rows for the HINDI section, drawn from the
 *     HINDI bank by lib/gd-hindi-picker.
 *
 * The new mock_test row is tagged stats_json.medium = 'HI' and
 * stats_json.paired_with = <EN mock id>. The EN mock's stats_json is
 * back-filled with paired_with = <HI mock id>.
 */
export async function POST(req, { params }) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: enMockId } = await params;
    const client = await db.connect();

    try {
        // 1. Load + verify EN mock
        const enRes = await client.query(`
            SELECT mock_test_id, exam_id, name, slug, blueprint_id,
                   status, test_type, difficulty_level, stats_json
            FROM mock_test WHERE mock_test_id = $1
        `, [enMockId]);
        if (enRes.rows.length === 0) {
            return NextResponse.json({ error: 'Mock not found' }, { status: 404 });
        }
        const en = enRes.rows[0];

        const SPEC = getSpecByExamId(en.exam_id);
        if (!SPEC || SPEC.examKey !== 'gd') {
            return NextResponse.json(
                { error: 'This route is for GD mocks only' },
                { status: 400 }
            );
        }
        if (!['APPROVED', 'PUBLISHED'].includes(en.status)) {
            return NextResponse.json(
                { error: `Pair creation requires APPROVED or PUBLISHED. Current: ${en.status}.` },
                { status: 400 }
            );
        }
        if (!en.stats_json?.hindi_translation_at) {
            return NextResponse.json(
                { error: 'Run translate-and-link first — hindi_translation_at not set on the EN mock.' },
                { status: 400 }
            );
        }
        if (en.stats_json?.medium === 'HI') {
            return NextResponse.json(
                { error: 'This mock is already the Hindi-medium pair.' },
                { status: 400 }
            );
        }
        if (en.stats_json?.paired_with) {
            // Idempotency: a previous run already paired this mock. Return
            // the existing pair rather than creating a duplicate.
            return NextResponse.json({
                success: true,
                already_paired: true,
                en_mock_id: enMockId,
                hi_mock_id: en.stats_json.paired_with,
            });
        }

        // 2. Pull the 60 EN mtq rows in REAS / GA / QUANT and resolve each to its HI sibling
        const inScopeSectionIds = ['REASONING', 'GA', 'QUANT']
            .map(c => SPEC.TARGET_SECTION_IDS[c]);

        // Resolve EACH EN qid to its best HI sibling. Multiple links per
        // english_question_id are tolerated by the schema (only
        // hindi_question_id is UNIQUE), so we deterministically prefer
        // human-corrected over machine-translated, then by lowest id.
        const enRowsRes = await client.query(`
            SELECT mtq.question_id, mtq.exam_section_id, mtq.position,
                   mtq.slot_subtype, mtq.slot_difficulty, mtq.group_id, mtq.score,
                   ql.hindi_question_id,
                   ql.status AS link_status
            FROM mock_test_question mtq
            LEFT JOIN LATERAL (
                SELECT q.hindi_question_id, q.status
                FROM question_links q
                WHERE q.english_question_id = mtq.question_id
                ORDER BY
                    CASE q.status
                        WHEN 'MANUALLY_CORRECTED' THEN 0
                        WHEN 'LINKED'             THEN 1
                        WHEN 'PENDING'            THEN 2
                        WHEN 'MACHINE_TRANSLATED' THEN 3
                        ELSE 4
                    END,
                    q.id ASC
                LIMIT 1
            ) ql ON true
            WHERE mtq.mock_test_id = $1
              AND mtq.exam_section_id = ANY($2)
            ORDER BY mtq.exam_section_id, mtq.position
        `, [enMockId, inScopeSectionIds]);

        const enRows = enRowsRes.rows;
        const missingHi = enRows.filter(r => !r.hindi_question_id);
        if (missingHi.length > 0) {
            return NextResponse.json({
                error: `Missing HI translations for ${missingHi.length} question(s). Re-run translate-and-link.`,
                missing_en_qids: missingHi.slice(0, 10).map(r => r.question_id),
            }, { status: 400 });
        }

        // 3. Pick 20 HINDI questions from the bank
        const hindiPick = await pickHindiSection({
            mockTestId: null,           // not known yet — picker just stamps positions
            config: en.stats_json?.config || {},
        });

        if (hindiPick.picks.length < 20) {
            return NextResponse.json({
                error: `HINDI bank underflow: only ${hindiPick.picks.length} of 20 picked.`,
                shortfalls: hindiPick.shortfalls,
                notes: hindiPick.notes,
            }, { status: 422 });
        }

        // 4. Write everything in a single transaction
        await client.query('BEGIN');

        const hiMockId = crypto.randomUUID();
        const hiName = en.name ? `${en.name} (Hindi)` : `GD Mock (Hindi)`;
        const hiSlug = en.slug ? `${en.slug}-hi` : null;

        const hiStats = {
            ...(en.stats_json?.config ? { config: en.stats_json.config } : {}),
            medium: 'HI',
            paired_with: enMockId,
            created_via: 'create-hindi-pair',
            created_at: new Date().toISOString(),
            hindi_section_notes: hindiPick.notes,
            hindi_section_shortfalls: hindiPick.shortfalls,
        };

        await client.query(`
            INSERT INTO mock_test
              (mock_test_id, blueprint_id, exam_id, name, slug, status,
               test_type, difficulty_level, stats_json, created_by,
               created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, 'DRAFT',
                    $6, $7, $8::jsonb, $9,
                    NOW(), NOW())
        `, [
            hiMockId, en.blueprint_id, en.exam_id, hiName, hiSlug,
            en.test_type || 'FULL_MOCK', en.difficulty_level,
            JSON.stringify(hiStats), user.id,
        ]);

        // 4a. Mirror the 60 EN rows → HI mtq rows (using HI sibling qid)
        for (const r of enRows) {
            await client.query(`
                INSERT INTO mock_test_question
                  (mock_test_id, question_id, exam_section_id, position,
                   slot_subtype, slot_difficulty, review_status,
                   group_id, score, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, NOW())
            `, [
                hiMockId, r.hindi_question_id, r.exam_section_id, r.position,
                r.slot_subtype, r.slot_difficulty, r.group_id, r.score,
            ]);
        }

        // 4b. Insert the 20 HINDI section rows
        for (const p of hindiPick.picks) {
            await client.query(`
                INSERT INTO mock_test_question
                  (mock_test_id, question_id, exam_section_id, position,
                   slot_subtype, slot_difficulty, review_status,
                   group_id, score, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, NOW())
            `, [
                hiMockId, p.question_id, p.exam_section_id, p.position,
                p.slot_subtype, p.slot_difficulty, p.group_id, p.score,
            ]);
        }

        // 4c. Back-fill EN mock's paired_with
        const enNewStats = { ...(en.stats_json || {}), paired_with: hiMockId, medium: 'EN' };
        await client.query(`
            UPDATE mock_test SET stats_json = $1::jsonb, updated_at = NOW()
            WHERE mock_test_id = $2
        `, [JSON.stringify(enNewStats), enMockId]);

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            en_mock_id: enMockId,
            hi_mock_id: hiMockId,
            mirrored_count: enRows.length,
            hindi_picked_count: hindiPick.picks.length,
            hindi_notes: hindiPick.notes,
            hindi_shortfalls: hindiPick.shortfalls,
        });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('gd-mock/create-hindi-pair error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
