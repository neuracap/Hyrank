import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for bulk processing

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function buildPrompt(questions, targetSections) {
    const qList = questions.map((q, i) => `Item ${i + 1}: ${q.text.substring(0, 300).replace(/\n/g, ' ')}...`).join('\n');
    const sectionList = targetSections.map(s => `${s.code} (${s.name})`).join(', ');

    return `
        You are an expert exam classifier.
        I have a list of exam questions.
        Classify each question into EXACTLY one of the following sections: [${sectionList}].

        ### GUIDELINES:
        - **English Comprehension:** Questions about grammar, vocabulary, idioms, spelling, active/passive voice, or reading comprehension passages.
        - **General Awareness:** Questions about history, science, geography, current affairs, books, or culture. These rely on fact retrieval, not calculation.
        - **General Intelligence and Reasoning:** Puzzles, logic, and patterns. Includes:
            - Coding/Decoding (converting letters to numbers).
            - Analogies (A is to B as C is to D).
            - Visual reasoning (mirror images, paper folding, embedded figures).
            - Blood relations and Venn diagrams.
            - Number Series/Puzzles: Finding the next number in a sequence or the missing number in a grid based on a logical pattern.
        - **Quantitative Aptitude:** Pure mathematics and calculation. Includes:
            - Arithmetic (Profit/Loss, Time/Work, Speed/Distance, Interest).
            - Advanced Math (Trigonometry, Geometry, Algebra, Mensuration/Volume).
            - Data Interpretation (Bar graphs, pie charts).
            - Number Properties (Divisibility, Remainders).

        ### CRITICAL TIE-BREAKER (Reasoning vs. Quant):
        - If the question involves numbers but asks to "complete the series," "find the odd pair," "select the related number," or "interchange signs," classify as **Reasoning**.
        - If the question asks to "calculate the area," "find the value of x," "solve for interest," or involves geometric proofs/theorems, classify as **Quantitative Aptitude**.

        Return ONLY a valid JSON object where keys are the Item numbers (e.g., "1", "2") and values are the section CODE from the list above.
        Do not output markdown code blocks. Just the JSON string.

        Questions:
        ${qList}
    `;
}

// Smart reclassify a single paper: only touch oversized sections, only classify into oversized+undersized
async function smartReclassifyPaper(client, paper_session_id, exam_id, num_questions) {
    const sectionsRes = await client.query(
        'SELECT section_id, code, name FROM exam_section WHERE exam_id = $1',
        [exam_id]
    );
    const allSections = sectionsRes.rows;
    if (allSections.length === 0) return { success: false, error: 'No sections defined' };

    const codeToIdMap = allSections.reduce((acc, s) => ({ ...acc, [s.code]: s.section_id, [s.code.toLowerCase()]: s.section_id }), {});

    const expectedPerSection = num_questions ? Math.round(num_questions / allSections.length) : 25;
    const oversizeThreshold = expectedPerSection * 1.5;
    const undersizeThreshold = expectedPerSection * 0.5;

    // Get current distribution
    const distRes = await client.query(`
        SELECT es.section_id, es.code, es.name, COUNT(qv.question_id) as count
        FROM exam_section es
        LEFT JOIN question_version qv ON qv.exam_section_id = es.section_id AND qv.paper_session_id = $1
        WHERE es.exam_id = $2
        GROUP BY es.section_id, es.code, es.name
    `, [paper_session_id, exam_id]);

    const distribution = distRes.rows.map(r => ({ ...r, count: parseInt(r.count) }));
    const oversized = distribution.filter(d => d.count > oversizeThreshold);
    const undersized = distribution.filter(d => d.count < undersizeThreshold);

    if (oversized.length === 0) return { success: true, processed: 0, updated: 0, skipped: true };

    // Target sections = oversized + undersized
    const targetSections = [...oversized, ...undersized].map(d => allSections.find(s => s.section_id === d.section_id));

    // Fetch questions ONLY from oversized sections
    const oversizedIds = oversized.map(d => d.section_id);
    const questionsRes = await client.query(`
        SELECT question_id, body_json->>'text' as text
        FROM question_version
        WHERE paper_session_id = $1 AND exam_section_id = ANY($2)
    `, [paper_session_id, oversizedIds]);

    const questions = questionsRes.rows;
    if (questions.length === 0) return { success: true, processed: 0, updated: 0 };

    // Call Gemini with only the target sections
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const prompt = buildPrompt(questions, targetSections);
    const result = await model.generateContent(prompt);
    const jsonStr = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const classification = JSON.parse(jsonStr);

    // Apply
    await client.query('BEGIN');
    let updatedCount = 0;

    for (const key in classification) {
        const index = parseInt(key, 10) - 1;
        if (isNaN(index) || index < 0 || index >= questions.length) continue;

        const questionId = questions[index].question_id;
        const newCode = classification[key];
        const newSectionId = codeToIdMap[newCode] || codeToIdMap[newCode.toUpperCase()];

        if (newSectionId) {
            const currentRes = await client.query('SELECT meta_json FROM question_version WHERE question_id = $1', [questionId]);
            if (currentRes.rows.length > 0) {
                const meta = currentRes.rows[0].meta_json || {};
                meta.section_name = newCode;

                await client.query(`
                    UPDATE question_version
                    SET exam_section_id = $1, meta_json = $2
                    WHERE question_id = $3
                `, [newSectionId, meta, questionId]);
                updatedCount++;
            }
        }
    }

    await client.query('COMMIT');
    return {
        success: true,
        processed: questions.length,
        updated: updatedCount,
        oversized: oversized.map(d => ({ code: d.code, count: d.count })),
        undersized: undersized.map(d => ({ code: d.code, count: d.count })),
        targetSections: targetSections.map(s => s.code)
    };
}

export async function POST(req) {
    const client = await db.connect();
    try {
        // Find papers that have at least one oversized section
        // A section is oversized if it has more than expected*1.5 questions
        // We detect this by comparing section count vs (num_questions / num_sections)
        const query = `
            SELECT
                ps.paper_session_id,
                ps.session_label,
                ps.exam_id,
                ps.paper_date,
                e.num_questions,
                es.code as section_code,
                es.name as section_name,
                COUNT(qv.question_id) as question_count,
                e.num_questions::float / NULLIF((SELECT COUNT(*) FROM exam_section WHERE exam_id = ps.exam_id), 0) as expected_per_section
            FROM paper_session ps
            JOIN exam e ON ps.exam_id = e.exam_id
            JOIN question_version qv ON qv.paper_session_id = ps.paper_session_id
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            GROUP BY ps.paper_session_id, ps.session_label, ps.exam_id, ps.paper_date, e.num_questions, es.code, es.name
            HAVING COUNT(qv.question_id) > (e.num_questions::float / NULLIF((SELECT COUNT(*) FROM exam_section WHERE exam_id = ps.exam_id), 0)) * 1.5
            ORDER BY ps.paper_date DESC, COUNT(qv.question_id) DESC
        `;

        const oversizedRes = await client.query(query);
        const oversizedSections = oversizedRes.rows;

        if (oversizedSections.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No papers need reclassification — all sections look balanced',
                totalPapers: 0,
                totalQuestionsUpdated: 0,
                details: []
            });
        }

        // Deduplicate by paper_session_id (a paper may have multiple oversized sections)
        const uniquePapers = [...new Map(oversizedSections.map(s => [s.paper_session_id, s])).values()];

        // Process up to 5 papers per run
        const papersToProcess = uniquePapers.slice(0, 5);
        const results = [];

        for (const paper of papersToProcess) {
            console.log(`Smart reclassifying: ${paper.session_label}`);

            const result = await smartReclassifyPaper(
                client,
                paper.paper_session_id,
                paper.exam_id,
                parseInt(paper.num_questions)
            );

            results.push({
                paper: paper.session_label,
                ...result
            });
        }

        const totalQuestionsUpdated = results.reduce((sum, r) => sum + (r.updated || 0), 0);
        const remainingPapers = uniquePapers.length - papersToProcess.length;

        return NextResponse.json({
            success: true,
            message: `Smart reclassified ${papersToProcess.length} paper(s)`,
            totalPapers: papersToProcess.length,
            totalQuestionsUpdated,
            details: results,
            remainingPapers,
            moreToProcess: remainingPapers > 0
        });

    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Bulk reclassification error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
