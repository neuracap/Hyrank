import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { canAccessSolutionReview } from '@/lib/permissions';

/**
 * POST /api/solution-review/bilingual-save
 * Save solution_json for a bilingual pair (EN and/or HI).
 * Body: {
 *   link_id,
 *   en: { question_id, version_no, solution_json, correct_option_label? },
 *   hi: { question_id, version_no, solution_json, correct_option_label? }
 * }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!canAccessSolutionReview(user)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { link_id, en, hi, difficulty, mock_worthiness } = body;
    if (!en && !hi) {
        return NextResponse.json({ error: 'At least one of en or hi is required' }, { status: 400 });
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        // Helper: apply optional question-body and per-option text edits.
        // Backward compatible — only runs when the caller sends body_text or options.
        const applyQuestionEdits = async (side, language) => {
            if (!side?.question_id) return;
            const versionNo = side.version_no || 1;

            if (typeof side.body_text === 'string') {
                const hasImage = /\\includegraphics|!\[.*?\]\(/.test(side.body_text);
                await client.query(`
                    UPDATE question_version
                    SET body_json = jsonb_set(COALESCE(body_json, '{}'::jsonb), '{text}', to_jsonb($1::text)),
                        has_image = $2,
                        updated_at = NOW()
                    WHERE question_id = $3 AND version_no = $4 AND language = $5
                `, [side.body_text, hasImage, side.question_id, versionNo, language]);
            }

            if (Array.isArray(side.options) && side.options.length > 0) {
                for (const opt of side.options) {
                    const label = opt.option_key || opt.opt_label;
                    if (!label) continue;
                    const text = opt.opt_text ?? opt.text ?? '';
                    const exists = await client.query(`
                        SELECT 1 FROM question_option
                        WHERE question_id = $1 AND version_no = $2 AND language = $3 AND option_key = $4
                    `, [side.question_id, versionNo, language, label]);
                    if (exists.rows.length > 0) {
                        await client.query(`
                            UPDATE question_option
                            SET option_json = jsonb_set(COALESCE(option_json, '{}'::jsonb), '{text}', to_jsonb($1::text))
                            WHERE question_id = $2 AND version_no = $3 AND language = $4 AND option_key = $5
                        `, [text, side.question_id, versionNo, language, label]);
                    } else {
                        await client.query(`
                            INSERT INTO question_option (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                            VALUES ($1, $2, $3, $4, jsonb_build_object('text', $5::text), false, NOW())
                        `, [side.question_id, versionNo, language, label, text]);
                    }
                }
            }
        };

        // Save EN solution
        if (en?.question_id && en.solution_json) {
            const solutionJson = JSON.stringify({
                ...en.solution_json,
                reviewed_by: user.id,
                saved_at: new Date().toISOString(),
            });

            await client.query(`
                UPDATE question_version SET
                    solution_json = $1::jsonb,
                    correct_option_label = COALESCE(NULLIF($2, ''), correct_option_label),
                    difficulty = COALESCE($5, difficulty),
                    mock_worthiness = COALESCE($6, mock_worthiness),
                    solution_status = 'DONE',
                    solution_generated_at = COALESCE(solution_generated_at, NOW()),
                    updated_at = NOW()
                WHERE question_id = $3 AND version_no = $4 AND language = 'EN'
            `, [solutionJson, en.correct_option_label || '', en.question_id, en.version_no || 1, difficulty || null, mock_worthiness || null]);

            // Update is_correct on options
            if (en.correct_option_label) {
                await client.query(`
                    UPDATE question_option SET is_correct = (option_key = $1)
                    WHERE question_id = $2 AND language = 'EN'
                `, [en.correct_option_label, en.question_id]);
            }
        }
        // Always apply question-body / option edits if present, even when
        // no solution_json was supplied (allows stem-only edits).
        await applyQuestionEdits(en, 'EN');

        // Save HI solution
        if (hi?.question_id && hi.solution_json) {
            const solutionJson = JSON.stringify({
                ...hi.solution_json,
                reviewed_by: user.id,
                saved_at: new Date().toISOString(),
            });

            await client.query(`
                UPDATE question_version SET
                    solution_json = $1::jsonb,
                    correct_option_label = COALESCE(NULLIF($2, ''), correct_option_label),
                    difficulty = COALESCE($5, difficulty),
                    mock_worthiness = COALESCE($6, mock_worthiness),
                    solution_status = 'DONE',
                    solution_generated_at = COALESCE(solution_generated_at, NOW()),
                    updated_at = NOW()
                WHERE question_id = $3 AND version_no = $4 AND language = 'HI'
            `, [solutionJson, hi.correct_option_label || '', hi.question_id, hi.version_no || 1, difficulty || null, mock_worthiness || null]);

            if (hi.correct_option_label) {
                await client.query(`
                    UPDATE question_option SET is_correct = (option_key = $1)
                    WHERE question_id = $2 AND language = 'HI'
                `, [hi.correct_option_label, hi.question_id]);
            }
        }
        await applyQuestionEdits(hi, 'HI');

        // Refresh the denormalized paper_session.solution_done_count (and
        // sibling count columns) for whichever paper sessions we touched.
        // The DB trigger SHOULD do this on its own, but field reports show
        // it occasionally fails to fire for HI sessions; calling the helper
        // explicitly here makes the dropdown on /new-solution-review-bilingual
        // stay accurate without relying on a periodic recount.
        const refreshSession = async (questionId, language) => {
            if (!questionId || !language) return;
            await client.query(`
                SELECT refresh_paper_session_counts(qv.paper_session_id)
                FROM question_version qv
                WHERE qv.question_id = $1 AND qv.language = $2 AND qv.paper_session_id IS NOT NULL
                LIMIT 1
            `, [questionId, language]);
        };
        await refreshSession(en?.question_id, 'EN');
        await refreshSession(hi?.question_id, 'HI');

        await client.query('COMMIT');
        return NextResponse.json({ success: true });

    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('solution-review/bilingual-save error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}
