import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/solution-review/save
 * Body: {
 *   paper_session_id,
 *   solutions: [{
 *     question_id, version_no,
 *     language?,             // 'EN' | 'HI' — defaults to 'EN' for backward compat
 *     answer_label?,         // legacy alias for correct_option_label
 *     correct_option_label?, // preferred
 *     solution_text?,        // legacy plain-text path
 *     full_json?,            // preferred: solution_json payload
 *     difficulty?, tags?, mock_worthiness?,
 *     body_text?,            // optional question stem edit
 *     options?,              // optional [{option_key, opt_text}] edits
 *   }]
 * }
 */
export async function POST(request) {
    const user = await getCurrentUser();
    if (!user || !user.isAdmin) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { paper_session_id, solutions } = body;
    if (!paper_session_id || !Array.isArray(solutions)) {
        return NextResponse.json({ error: 'paper_session_id and solutions array are required' }, { status: 400 });
    }

    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');

        let saved = 0;
        const touchedQids = [];

        const applyQuestionEdits = async (qid, vno, lang, side) => {
            if (!qid) return;
            if (typeof side.body_text === 'string') {
                const hasImage = /\\includegraphics|!\[.*?\]\(/.test(side.body_text);
                await client.query(`
                    UPDATE question_version
                    SET body_json = jsonb_set(COALESCE(body_json, '{}'::jsonb), '{text}', to_jsonb($1::text)),
                        has_image = $2,
                        updated_at = NOW()
                    WHERE question_id = $3 AND version_no = $4 AND language = $5
                `, [side.body_text, hasImage, qid, vno, lang]);
            }
            if (Array.isArray(side.options) && side.options.length > 0) {
                for (const opt of side.options) {
                    const label = opt.option_key || opt.opt_label;
                    if (!label) continue;
                    const text = opt.opt_text ?? opt.text ?? '';
                    const exists = await client.query(`
                        SELECT 1 FROM question_option
                        WHERE question_id = $1 AND version_no = $2 AND language = $3 AND option_key = $4
                    `, [qid, vno, lang, label]);
                    if (exists.rows.length > 0) {
                        await client.query(`
                            UPDATE question_option
                            SET option_json = jsonb_set(COALESCE(option_json, '{}'::jsonb), '{text}', to_jsonb($1::text))
                            WHERE question_id = $2 AND version_no = $3 AND language = $4 AND option_key = $5
                        `, [text, qid, vno, lang, label]);
                    } else {
                        await client.query(`
                            INSERT INTO question_option (question_id, version_no, language, option_key, option_json, is_correct, created_at)
                            VALUES ($1, $2, $3, $4, jsonb_build_object('text', $5::text), false, NOW())
                        `, [qid, vno, lang, label, text]);
                    }
                }
            }
        };

        for (const sol of solutions) {
            const {
                question_id, version_no,
                answer_label, correct_option_label,
                solution_text, difficulty, tags, full_json, mock_worthiness,
            } = sol;
            if (!question_id || version_no == null) continue;

            const language = (sol.language || 'EN').toUpperCase();
            const correctLabel = correct_option_label || answer_label || '';

            if (full_json) {
                const solutionJson = JSON.stringify({
                    ...full_json,
                    reviewed_by: user.id,
                    saved_at: new Date().toISOString(),
                });

                await client.query(`
                    UPDATE question_version SET
                        solution_json = $1::jsonb,
                        correct_option_label = COALESCE(NULLIF($6, ''), correct_option_label),
                        difficulty = COALESCE($4, difficulty),
                        mock_worthiness = COALESCE($5, mock_worthiness),
                        solution_status = 'DONE',
                        solution_generated_at = COALESCE(solution_generated_at, NOW()),
                        updated_at = NOW()
                    WHERE question_id = $2 AND version_no = $3 AND language = $7
                `, [solutionJson, question_id, version_no, difficulty || null, mock_worthiness || null, correctLabel, language]);
            } else {
                const solutionJson = JSON.stringify({
                    answer_label: correctLabel || null,
                    solution_text: solution_text || null,
                    tags: tags || null,
                    updated_at: new Date().toISOString(),
                });

                await client.query(`
                    UPDATE question_version
                    SET
                        solution_json = $1::jsonb,
                        correct_option_label = COALESCE(NULLIF($5, ''), correct_option_label),
                        difficulty = COALESCE(NULLIF($2, ''), difficulty),
                        updated_at = NOW()
                    WHERE question_id = $3
                      AND version_no = $4
                      AND language = $6
                `, [solutionJson, difficulty || '', question_id, version_no, correctLabel, language]);
            }

            if (correctLabel) {
                await client.query(`
                    UPDATE question_option
                    SET is_correct = (option_key = $1)
                    WHERE question_id = $2
                      AND language = $3
                `, [correctLabel, question_id, language]);
            }

            await applyQuestionEdits(question_id, version_no, language, sol);
            touchedQids.push({ qid: question_id, lang: language });

            saved++;
        }

        // Refresh denormalized solution_done_count on the paper_session
        // so dashboards stay accurate without waiting for the periodic recount.
        for (const t of touchedQids) {
            await client.query(`
                SELECT refresh_paper_session_counts(qv.paper_session_id)
                FROM question_version qv
                WHERE qv.question_id = $1 AND qv.language = $2 AND qv.paper_session_id IS NOT NULL
                LIMIT 1
            `, [t.qid, t.lang]);
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true, saved });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('solution-review/save error:', error);
        return NextResponse.json({ error: 'Failed to save solutions', details: error.message }, { status: 500 });
    } finally {
        client?.release();
    }
}
