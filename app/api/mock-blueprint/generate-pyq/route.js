import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';

/**
 * POST /api/mock-blueprint/generate-pyq
 * Analyse a set of PYQ years for an exam, compute per-section subtype
 * distributions (average count per year), and save as a blueprint.
 *
 * Body: {
 *   exam_id,
 *   name?,       — auto-generated if omitted
 *   years,       — [2025, 2024, 2023, 2022]  (must have at least one)
 *   questions_per_year?  — override per-year question count per section
 *                          (defaults to the actual avg from those years)
 * }
 *
 * Returns: { blueprint_id, name, config_json }
 */
export async function POST(req) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { exam_id, name, years, questions_per_year } = body;
    if (!exam_id || !Array.isArray(years) || years.length === 0) {
        return NextResponse.json({ error: 'exam_id and years[] are required' }, { status: 400 });
    }

    try {
        // 1. Verify exam + get sections
        const examRes = await db.query(`
            SELECT e.exam_id, e.name AS exam_name,
                   json_agg(json_build_object(
                       'section_id', es.section_id,
                       'code', es.code,
                       'name', es.name,
                       'num_questions', es.num_questions
                   ) ORDER BY es.sort_order ASC NULLS LAST) AS sections
            FROM exam e
            JOIN exam_section es ON es.exam_id = e.exam_id
            WHERE e.exam_id = $1
            GROUP BY e.exam_id, e.name
        `, [exam_id]);

        if (examRes.rows.length === 0) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 });
        }
        const { exam_name, sections } = examRes.rows[0];

        // 2. For each year, get distinct paper_session_ids so we can count "papers per year"
        const papersByYear = {};
        for (const yr of years) {
            const psRes = await db.query(`
                SELECT DISTINCT ps.paper_session_id
                FROM paper_session ps
                WHERE ps.exam_id = $1
                  AND EXTRACT(YEAR FROM ps.paper_date) = $2
                  AND ps.paper_date IS NOT NULL
            `, [exam_id, yr]);
            papersByYear[yr] = psRes.rows.map(r => r.paper_session_id);
        }

        // 3. For each section × year, get subtype distribution
        //    subtype_data[section_id][year][subtype] = question count
        const subtypeData = {};
        for (const section of sections) {
            subtypeData[section.section_id] = {};
            for (const yr of years) {
                const pIds = papersByYear[yr];
                if (!pIds.length) { subtypeData[section.section_id][yr] = {}; continue; }

                const res = await db.query(`
                    SELECT qv.subtype, COUNT(*) AS cnt
                    FROM question_version qv
                    WHERE qv.exam_section_id = $1
                      AND qv.paper_session_id = ANY($2)
                      AND qv.language = 'EN'
                      AND qv.status = 'MANUALLY_CORRECTED'
                      AND qv.subtype IS NOT NULL
                    GROUP BY qv.subtype
                    ORDER BY cnt DESC
                `, [section.section_id, pIds]);

                subtypeData[section.section_id][yr] = {};
                for (const row of res.rows) {
                    subtypeData[section.section_id][yr][row.subtype] = parseInt(row.cnt);
                }
            }
        }

        // 4. Build config_json: average subtype count across selected years (per paper)
        const configSections = sections.map(section => {
            const byYear = subtypeData[section.section_id];
            const yearsWithData = years.filter(yr => Object.keys(byYear[yr] || {}).length > 0);

            if (yearsWithData.length === 0) {
                return {
                    section_id:  section.section_id,
                    code:        section.code,
                    name:        section.name,
                    total:       0,
                    topic_slots: [],
                };
            }

            // Collect all subtypes seen across selected years
            const allSubtypes = [...new Set(yearsWithData.flatMap(yr => Object.keys(byYear[yr])))];

            // For each subtype: average count per year (round to nearest int, min 1)
            const topic_slots = allSubtypes
                .map(subtype => {
                    const counts = yearsWithData.map(yr => byYear[yr][subtype] || 0);
                    const paperCounts = yearsWithData.map(yr => Math.max(papersByYear[yr].length, 1));
                    // avg questions per paper for this subtype across years
                    const avgPerPaper = counts.reduce((sum, c, i) => sum + c / paperCounts[i], 0) / yearsWithData.length;
                    const count = questions_per_year
                        ? Math.round(questions_per_year * (avgPerPaper / (Object.values(byYear[yearsWithData[0]] || {}).reduce((a, b) => a + b, 0) || 1)))
                        : Math.max(1, Math.round(avgPerPaper));
                    return { subtype, count, years_seen: yearsWithData.length };
                })
                .filter(s => s.count > 0)
                .sort((a, b) => b.count - a.count); // most common first

            const total = topic_slots.reduce((a, s) => a + s.count, 0);

            return {
                section_id:  section.section_id,
                code:        section.code,
                name:        section.name,
                total,
                topic_slots,
            };
        });

        const blueprintName = name?.trim() ||
            `${exam_name} PYQ ${Math.min(...years)}–${Math.max(...years)}`;

        const config_json = {
            sections: configSections,
            generated_from: { type: 'PYQ', years, generated_at: new Date().toISOString() },
        };

        // 5. Save blueprint
        const saveRes = await db.query(`
            INSERT INTO mock_blueprint (exam_id, name, config_json, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, true, NOW(), NOW())
            RETURNING blueprint_id
        `, [exam_id, blueprintName, JSON.stringify(config_json)]);

        return NextResponse.json({
            success:      true,
            blueprint_id: saveRes.rows[0].blueprint_id,
            name:         blueprintName,
            config_json,
        });

    } catch (e) {
        console.error('mock-blueprint/generate-pyq error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
