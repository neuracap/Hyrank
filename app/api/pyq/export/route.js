import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/pyq/export?exam_id=...&year=2023&limit=5
 *
 * Returns a JSON manifest of up to `limit` PYQ paper sessions for the given
 * exam + year, in clone-ready + re-ingest-ready shape. Each question carries
 * a `raw` block (every *_json column verbatim) and a `clone` block (extracted
 * plain text per language) so the consumer can either re-ingest or feed it
 * to an LLM for variant generation.
 */
export async function GET(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const exam_id = searchParams.get('exam_id');
    const yearStr = searchParams.get('year');
    const limitStr = searchParams.get('limit') || '5';

    if (!exam_id || !yearStr) {
        return NextResponse.json({ error: 'exam_id and year are required' }, { status: 400 });
    }
    const year = parseInt(yearStr, 10);
    const limit = Math.min(Math.max(parseInt(limitStr, 10) || 5, 1), 50);

    const client = await db.connect();
    try {
        // 1) Exam metadata
        const examRes = await client.query(
            `SELECT exam_id, name FROM exam WHERE exam_id = $1`,
            [exam_id]
        );
        if (examRes.rows.length === 0) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 });
        }
        const exam = examRes.rows[0];

        // 2) Pick paper sessions for that exam + year, deterministic order
        //    (most recent first, then by shift_number) — only those that have
        //    EN questions of acceptable status, paper_session_id IS NOT NULL.
        const psRes = await client.query(
            `
            SELECT DISTINCT
                ps.paper_session_id, ps.session_label, ps.paper_date,
                ps.tier, ps.shift_label, ps.shift_number, ps.subject,
                ps.official_source, ps.language
            FROM paper_session ps
            WHERE ps.exam_id = $1
              AND EXTRACT(YEAR FROM ps.paper_date)::int = $2
              AND EXISTS (
                  SELECT 1 FROM question_version qv
                  WHERE qv.paper_session_id = ps.paper_session_id
                    AND qv.language = 'EN'
                    AND qv.status = 'MANUALLY_CORRECTED'
              )
            ORDER BY ps.paper_date DESC, ps.shift_number NULLS LAST, ps.session_label
            LIMIT $3
            `,
            [exam_id, year, limit]
        );

        const paperSessionIds = psRes.rows.map(r => r.paper_session_id);
        if (paperSessionIds.length === 0) {
            return NextResponse.json({
                export_meta: buildExportMeta(exam, year, limit, 0),
                papers: [],
            });
        }

        // 3) Sections in scope (those that actually appear on these papers)
        const secRes = await client.query(
            `
            SELECT DISTINCT es.section_id, es.exam_id, es.code, es.name, es.sort_order
            FROM exam_section es
            JOIN question_version qv ON qv.exam_section_id = es.section_id
            WHERE qv.paper_session_id = ANY($1)
            `,
            [paperSessionIds]
        );
        const sectionsById = new Map(secRes.rows.map(s => [s.section_id, s]));

        // 4) ALL EN question_versions for these papers (one round trip)
        //    Excludes image questions and unsolved questions — text + done only.
        const enQRes = await client.query(
            `
            SELECT qv.question_id, qv.version_no, qv.language,
                   qv.paper_session_id, qv.exam_section_id,
                   qv.status, qv.solution_status, qv.is_verified,
                   qv.subtype, qv.difficulty, qv.question_type,
                   qv.correct_option_label, qv.has_image,
                   qv.source_question_no, qv.question_number_int,
                   qv.body_json, qv.solution_json, qv.meta_json,
                   qv.group_id, qv.group_order
            FROM question_version qv
            WHERE qv.paper_session_id = ANY($1)
              AND qv.language = 'EN'
              AND qv.status = 'MANUALLY_CORRECTED'
              AND qv.solution_status = 'DONE'
              AND qv.has_image = false
            ORDER BY qv.paper_session_id, qv.exam_section_id, qv.question_number_int NULLS LAST, qv.source_question_no NULLS LAST
            `,
            [paperSessionIds]
        );
        const enQuestions = enQRes.rows;
        const enQuestionIds = enQuestions.map(q => q.question_id);

        // 5) HI counterparts via question_links (whichever direction)
        const linkRes = await client.query(
            `
            SELECT english_question_id, hindi_question_id
            FROM question_links
            WHERE english_question_id = ANY($1) OR hindi_question_id = ANY($1)
            `,
            [enQuestionIds]
        );
        const enToHi = new Map();
        for (const r of linkRes.rows) {
            if (enQuestionIds.includes(r.english_question_id)) {
                enToHi.set(r.english_question_id, r.hindi_question_id);
            }
        }
        const hiQuestionIds = [...enToHi.values()];

        // 6) Fetch HI versions for the linked ids
        let hiQuestions = [];
        if (hiQuestionIds.length > 0) {
            const hiQRes = await client.query(
                `
                SELECT qv.question_id, qv.version_no, qv.language,
                       qv.paper_session_id, qv.exam_section_id,
                       qv.status, qv.solution_status, qv.is_verified,
                       qv.subtype, qv.difficulty, qv.question_type,
                       qv.correct_option_label, qv.has_image,
                       qv.source_question_no, qv.question_number_int,
                       qv.body_json, qv.solution_json, qv.meta_json,
                       qv.group_id, qv.group_order
                FROM question_version qv
                WHERE qv.question_id = ANY($1)
                  AND qv.language = 'HI'
                  AND qv.has_image = false
                `,
                [hiQuestionIds]
            );
            hiQuestions = hiQRes.rows;
        }
        const hiByQid = new Map(hiQuestions.map(q => [q.question_id, q]));

        // 7) Options for both EN + HI in one query
        const allQids = [...enQuestionIds, ...hiQuestionIds];
        const optRes = await client.query(
            `
            SELECT question_id, version_no, language, option_key,
                   option_json, is_correct
            FROM question_option
            WHERE question_id = ANY($1)
            ORDER BY question_id, language, option_key
            `,
            [allQids]
        );
        const optionsByKey = new Map();
        for (const o of optRes.rows) {
            const key = `${o.question_id}|${o.language}`;
            if (!optionsByKey.has(key)) optionsByKey.set(key, []);
            optionsByKey.get(key).push(o);
        }

        // 8) Image assets — both stems and option figures and solutions
        const assetRes = await client.query(
            `
            SELECT qam.question_id, qam.version_no, qam.language,
                   qam.role, qam.option_key,
                   a.local_path, a.original_name, a.asset_type
            FROM question_asset_map qam
            JOIN asset a ON a.asset_id = qam.asset_id
            WHERE qam.question_id = ANY($1)
            ORDER BY qam.question_id, qam.language, qam.role, qam.option_key
            `,
            [allQids]
        );
        const assetsByKey = new Map();
        for (const a of assetRes.rows) {
            const key = `${a.question_id}|${a.language || 'EN'}`;
            if (!assetsByKey.has(key)) assetsByKey.set(key, []);
            assetsByKey.get(key).push({
                role: a.role,
                option_key: a.option_key,
                url: resolveAssetUrl(a.local_path),
                original_name: a.original_name,
                asset_type: a.asset_type,
            });
        }

        // 8b) Source PDF paths — same algorithm bilingual/test pages use:
        //     paper_session.raw_mmd_doc_id → raw_mmd_doc.import_job_id → import_job.source_pdf_path
        const pdfRes = await client.query(
            `
            SELECT ps.paper_session_id, j.source_pdf_path
            FROM paper_session ps
            LEFT JOIN raw_mmd_doc d ON ps.raw_mmd_doc_id = d.raw_mmd_doc_id
            LEFT JOIN import_job j  ON d.import_job_id   = j.import_job_id
            WHERE ps.paper_session_id = ANY($1)
            `,
            [paperSessionIds]
        );
        const pdfByPaper = new Map(pdfRes.rows.map(r => [r.paper_session_id, r.source_pdf_path]));

        // 9) Question groups (RC/Cloze passages)
        const groupIds = [...new Set(
            enQuestions.map(q => q.group_id).concat(hiQuestions.map(q => q.group_id))
                .filter(Boolean)
        )];
        let groupsById = new Map();
        if (groupIds.length > 0) {
            const grpRes = await client.query(
                `
                SELECT group_id, group_type, passage_en, passage_hi, exam_section_id
                FROM question_group
                WHERE group_id = ANY($1)
                `,
                [groupIds]
            );
            groupsById = new Map(grpRes.rows.map(g => [g.group_id, g]));
        }

        // 10) Stitch into paper-by-paper output
        const enByPaper = new Map();
        for (const q of enQuestions) {
            if (!enByPaper.has(q.paper_session_id)) enByPaper.set(q.paper_session_id, []);
            enByPaper.get(q.paper_session_id).push(q);
        }

        const papers = [];
        for (const ps of psRes.rows) {
            const enQs = enByPaper.get(ps.paper_session_id) || [];

            // Group EN questions by section
            const bySection = new Map();
            for (const q of enQs) {
                if (!bySection.has(q.exam_section_id)) bySection.set(q.exam_section_id, []);
                bySection.get(q.exam_section_id).push(q);
            }

            const sections = [];
            const cov = { questions_total: 0, with_hi: 0, verified: 0 };

            // Order sections by section.sort_order
            const sectionEntries = [...bySection.entries()].sort((a, b) => {
                const sa = sectionsById.get(a[0])?.sort_order ?? 9999;
                const sb = sectionsById.get(b[0])?.sort_order ?? 9999;
                return sa - sb;
            });

            for (const [sectionId, qs] of sectionEntries) {
                const sec = sectionsById.get(sectionId);
                const questionList = [];
                let position = 1;
                for (const enQ of qs) {
                    const hiQid = enToHi.get(enQ.question_id);
                    const hiQ = hiQid ? hiByQid.get(hiQid) : null;

                    const enOpts = optionsByKey.get(`${enQ.question_id}|EN`) || [];
                    const hiOpts = hiQ ? (optionsByKey.get(`${hiQ.question_id}|HI`) || []) : [];

                    const enImgs = assetsByKey.get(`${enQ.question_id}|EN`) || [];
                    const hiImgs = hiQ ? (assetsByKey.get(`${hiQ.question_id}|HI`) || []) : [];

                    const correctOption = resolveCorrectOption(enQ, enOpts);

                    let group = null;
                    if (enQ.group_id) {
                        const g = groupsById.get(enQ.group_id);
                        if (g) {
                            group = {
                                group_id: g.group_id,
                                group_type: g.group_type,
                                group_order: enQ.group_order,
                                passage_en: g.passage_en,
                                passage_hi: g.passage_hi,
                            };
                        }
                    }

                    cov.questions_total++;
                    if (hiQ) cov.with_hi++;
                    if (enQ.is_verified) cov.verified++;

                    questionList.push({
                        position: position++,
                        source_question_no: enQ.source_question_no,
                        question_number_int: enQ.question_number_int,
                        subtype: enQ.subtype,
                        difficulty: enQ.difficulty,
                        question_type: enQ.question_type,
                        is_verified: enQ.is_verified,
                        solution_status: enQ.solution_status,
                        correct_option: correctOption,
                        group,
                        raw: {
                            en: buildRaw(enQ, enOpts, enImgs),
                            hi: hiQ ? buildRaw(hiQ, hiOpts, hiImgs) : null,
                        },
                        clone: {
                            en: buildClone(enQ, enOpts),
                            hi: hiQ ? buildClone(hiQ, hiOpts) : null,
                        },
                    });
                }
                sections.push({
                    section_id: sectionId,
                    code: sec?.code || null,
                    name: sec?.name || null,
                    sort_order: sec?.sort_order ?? null,
                    question_count: questionList.length,
                    questions: questionList,
                });
            }

            const sourcePdfPath = pdfByPaper.get(ps.paper_session_id) || null;
            const pdfUrl = sourcePdfPath
                ? `/api/pdf?path=${encodeURIComponent(sourcePdfPath)}`
                : null;

            papers.push({
                paper_meta: {
                    paper_session_id: ps.paper_session_id,
                    session_label: ps.session_label,
                    paper_date: ps.paper_date,
                    year,
                    tier: ps.tier,
                    shift_label: ps.shift_label,
                    shift_number: ps.shift_number,
                    subject: ps.subject,
                    official_source: ps.official_source,
                    language: ps.language,
                    source_pdf_path: sourcePdfPath,
                    pdf_url: pdfUrl,
                },
                coverage: cov,
                sections,
            });
        }

        return NextResponse.json({
            export_meta: buildExportMeta(exam, year, limit, papers.length),
            papers,
        });
    } catch (e) {
        console.error('pyq/export error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    } finally {
        client.release();
    }
}

function buildExportMeta(exam, year, requested, returned) {
    return {
        exam_id: exam.exam_id,
        exam_name: exam.name,
        year,
        requested_papers: requested,
        returned_papers: returned,
        filters: {
            solution_status: 'DONE',
            has_image: false,
            status: 'MANUALLY_CORRECTED',
        },
        exported_at: new Date().toISOString(),
        schema_version: 1,
    };
}

function buildRaw(qv, opts, imgs) {
    return {
        question_id: qv.question_id,
        version_no: qv.version_no,
        language: qv.language,
        status: qv.status,
        solution_status: qv.solution_status,
        is_verified: qv.is_verified,
        subtype: qv.subtype,
        difficulty: qv.difficulty,
        question_type: qv.question_type,
        correct_option_label: qv.correct_option_label,
        has_image: qv.has_image,
        source_question_no: qv.source_question_no,
        question_number_int: qv.question_number_int,
        body_json: qv.body_json,
        solution_json: qv.solution_json,
        meta_json: qv.meta_json,
        group_id: qv.group_id,
        group_order: qv.group_order,
        options: opts.map(o => ({
            option_key: o.option_key,
            option_json: o.option_json,
            is_correct: o.is_correct,
        })),
        images: imgs,
    };
}

function buildClone(qv, opts) {
    return {
        stem_text: extractText(qv.body_json),
        stem_format: qv.body_json?.format || null,
        options: opts.map(o => ({
            key: o.option_key,
            text: extractText(o.option_json),
            is_correct: o.is_correct,
        })),
        solution_text: extractText(qv.solution_json),
    };
}

function extractText(j) {
    if (j == null) return '';
    if (typeof j === 'string') return j;
    if (typeof j !== 'object') return String(j);
    if (typeof j.text === 'string') return j.text;
    if (typeof j.markdown === 'string') return j.markdown;
    if (typeof j.content === 'string') return j.content;
    if (typeof j.html === 'string') return j.html;
    if (typeof j.solution_md === 'string') return j.solution_md;
    if (typeof j.explanation === 'string') return j.explanation;
    return '';
}

function resolveCorrectOption(qv, opts) {
    if (qv.correct_option_label) return qv.correct_option_label.toUpperCase();
    const correct = opts.find(o => o.is_correct);
    return correct ? correct.option_key : null;
}

function resolveAssetUrl(localPath) {
    if (!localPath) return null;
    if (localPath.startsWith('http://') || localPath.startsWith('https://')) {
        return localPath; // Cloudinary secure_url
    }
    return null; // legacy local path — not portable
}
