import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { generateSectionTest, SectionTestError } from '@/lib/section-test-generator';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_MAX_PER_SECTION = 3;

/**
 * POST /api/section-test/bulk-generate
 * Body: { exam_id, max_per_section? = 3 }
 *
 * For each section in this exam, generate up to `max_per_section` section
 * tests in sequence. Each generation locks its questions for future SECTION
 * tests (but they remain eligible for TOPIC and FULL_MOCK).
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { exam_id, max_per_section, difficulty_level } = await req.json();
    if (!exam_id) {
        return NextResponse.json({ error: 'exam_id is required' }, { status: 400 });
    }
    const level = parseInt(difficulty_level, 10);
    if (![1, 2, 3].includes(level)) {
        return NextResponse.json({ error: 'difficulty_level must be 1, 2 or 3' }, { status: 400 });
    }
    const cap = Math.max(1, Math.min(10, parseInt(max_per_section, 10) || DEFAULT_MAX_PER_SECTION));

    const client = await db.connect();
    try {
        const sectionsRes = await client.query(`
            SELECT code FROM exam_section
            WHERE exam_id = $1
            ORDER BY sort_order ASC NULLS LAST, code ASC
        `, [exam_id]);

        if (sectionsRes.rows.length === 0) {
            client.release();
            return NextResponse.json({ error: 'Exam has no sections' }, { status: 404 });
        }

        const created = [];
        const skipped = [];

        for (const { code } of sectionsRes.rows) {
            const mocks = [];
            for (let i = 0; i < cap; i++) {
                try {
                    const r = await generateSectionTest(client, {
                        exam_id, section_code: code, difficulty_level: level, user_id: user.id,
                    });
                    mocks.push({
                        mock_test_id: r.mock_test_id,
                        name: r.name,
                        section_code: r.section_code,
                        target: r.total_target,
                        selected: r.total_selected,
                    });
                } catch (e) {
                    if (e instanceof SectionTestError && e.status === 409) {
                        if (i === 0) skipped.push({ section_code: code, reason: e.message });
                        break;
                    }
                    skipped.push({
                        section_code: code,
                        reason: `Generation error after ${i} tests: ${e.message}`,
                    });
                    break;
                }
            }
            if (mocks.length > 0) {
                created.push({ section_code: code, count: mocks.length, mocks });
            }
        }

        const total_created = created.reduce((s, c) => s + c.count, 0);

        return NextResponse.json({
            success: true,
            total_created,
            total_skipped: skipped.length,
            cap_per_section: cap,
            created,
            skipped,
        });

    } catch (e) {
        console.error('section-test/bulk-generate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
