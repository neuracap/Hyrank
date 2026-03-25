import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mock-test/blueprint/analyze
 * Analyze past papers for an exam to suggest a blueprint config.
 * Body: { exam_id }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { exam_id } = await req.json();
    if (!exam_id) {
        return NextResponse.json({ error: 'exam_id is required' }, { status: 400 });
    }

    try {
        // 1. Get exam info
        const examRes = await db.query(`SELECT exam_id, name FROM exam WHERE exam_id = $1`, [exam_id]);
        if (examRes.rows.length === 0) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 });
        }
        const exam = examRes.rows[0];

        // 2. Get sections for this exam
        const sectionsRes = await db.query(`
            SELECT section_id, code, name, sort_order
            FROM exam_section
            WHERE exam_id = $1
            ORDER BY sort_order ASC NULLS LAST, name ASC
        `, [exam_id]);

        // 3. For each section, analyze subtype distribution from solved questions
        const sections = [];
        let totalPapers = 0;

        // Count distinct papers
        const paperCountRes = await db.query(`
            SELECT COUNT(DISTINCT ps.paper_session_id) AS paper_count
            FROM paper_session ps
            WHERE ps.exam_id = $1
        `, [exam_id]);
        totalPapers = parseInt(paperCountRes.rows[0]?.paper_count || 0);

        for (const section of sectionsRes.rows) {
            // Subtype distribution across all papers
            const subtypeRes = await db.query(`
                SELECT
                    qv.subtype,
                    COUNT(*) AS total_count,
                    COUNT(DISTINCT qv.paper_session_id) AS paper_count,
                    ROUND(COUNT(*)::numeric / GREATEST(COUNT(DISTINCT qv.paper_session_id), 1), 1) AS avg_per_paper,
                    COUNT(*) FILTER (WHERE qv.difficulty = 1) AS easy_count,
                    COUNT(*) FILTER (WHERE qv.difficulty = 2) AS medium_count,
                    COUNT(*) FILTER (WHERE qv.difficulty = 3) AS hard_count
                FROM question_version qv
                WHERE qv.exam_section_id = $1
                  AND qv.subtype IS NOT NULL
                  AND qv.solution_status = 'DONE'
                  AND qv.language = 'EN'
                GROUP BY qv.subtype
                ORDER BY COUNT(*) DESC
            `, [section.section_id]);

            // Overall section stats
            const sectionStatsRes = await db.query(`
                SELECT
                    COUNT(*) AS total,
                    COUNT(DISTINCT qv.paper_session_id) AS papers,
                    ROUND(COUNT(*)::numeric / GREATEST(COUNT(DISTINCT qv.paper_session_id), 1), 0) AS avg_questions_per_paper,
                    COUNT(*) FILTER (WHERE qv.difficulty = 1) AS easy_total,
                    COUNT(*) FILTER (WHERE qv.difficulty = 2) AS medium_total,
                    COUNT(*) FILTER (WHERE qv.difficulty = 3) AS hard_total
                FROM question_version qv
                WHERE qv.exam_section_id = $1
                  AND qv.solution_status = 'DONE'
                  AND qv.language = 'EN'
            `, [section.section_id]);

            const stats = sectionStatsRes.rows[0] || {};
            const avgPerPaper = parseInt(stats.avg_questions_per_paper || 25);
            const totalQ = parseInt(stats.total || 0);
            const easyPct = totalQ > 0 ? parseInt(stats.easy_total) / totalQ : 0.35;
            const mediumPct = totalQ > 0 ? parseInt(stats.medium_total) / totalQ : 0.45;
            const hardPct = totalQ > 0 ? parseInt(stats.hard_total) / totalQ : 0.20;

            // Build topic slots from subtype analysis
            const topicSlots = subtypeRes.rows
                .filter(r => parseFloat(r.avg_per_paper) >= 0.5) // at least 0.5 per paper on average
                .map(r => ({
                    subtype: r.subtype,
                    count: Math.round(parseFloat(r.avg_per_paper)),
                    total_in_pool: parseInt(r.total_count),
                    papers_seen_in: parseInt(r.paper_count),
                    avg_per_paper: parseFloat(r.avg_per_paper),
                }));

            // Ensure total slot counts roughly match avg_per_paper
            let slotTotal = topicSlots.reduce((s, t) => s + t.count, 0);
            // If slots don't add up, add a misc slot
            if (slotTotal < avgPerPaper) {
                topicSlots.push({
                    subtype: `misc_${section.code.toLowerCase()}`,
                    count: avgPerPaper - slotTotal,
                    total_in_pool: 0,
                    papers_seen_in: 0,
                    avg_per_paper: 0,
                });
            }

            sections.push({
                section_id: section.section_id,
                code: section.code,
                name: section.name,
                total: avgPerPaper,
                difficulty_target: {
                    easy: { min: Math.floor(avgPerPaper * easyPct * 0.8), max: Math.ceil(avgPerPaper * easyPct * 1.2) },
                    medium: { min: Math.floor(avgPerPaper * mediumPct * 0.8), max: Math.ceil(avgPerPaper * mediumPct * 1.2) },
                    hard: { min: Math.floor(avgPerPaper * hardPct * 0.8), max: Math.ceil(avgPerPaper * hardPct * 1.2) },
                },
                topic_slots: topicSlots,
                groups: [], // admin can add RC/Cloze groups manually
                stats: {
                    total_questions_analyzed: totalQ,
                    papers_analyzed: parseInt(stats.papers || 0),
                    easy_pct: Math.round(easyPct * 100),
                    medium_pct: Math.round(mediumPct * 100),
                    hard_pct: Math.round(hardPct * 100),
                },
            });
        }

        return NextResponse.json({
            success: true,
            exam: { exam_id: exam.exam_id, name: exam.name },
            total_papers: totalPapers,
            suggested_config: { sections },
        });
    } catch (e) {
        console.error('mock-test/blueprint/analyze error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
