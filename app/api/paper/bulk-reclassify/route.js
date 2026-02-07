import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for bulk processing

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper function to reclassify a single section
async function reclassifySection(client, paper_session_id, section_code, exam_id) {
    // Fetch valid sections for this exam
    const sectionsRes = await client.query(
        'SELECT section_id, code, name FROM exam_section WHERE exam_id = $1',
        [exam_id]
    );
    const validSections = sectionsRes.rows;
    const codeToIdMap = validSections.reduce((acc, s) => ({ ...acc, [s.code]: s.section_id, [s.code.toLowerCase()]: s.section_id }), {});

    // Get section_id from code
    const targetId = codeToIdMap[section_code] || codeToIdMap[section_code.toLowerCase()];
    if (!targetId) return { success: false, error: 'Section not found' };

    // Fetch questions in this section
    const questionsRes = await client.query(`
        SELECT question_id, body_json->>'text' as text
        FROM question_version
        WHERE paper_session_id = $1 AND exam_section_id = $2
    `, [paper_session_id, targetId]);

    const questions = questionsRes.rows;
    if (questions.length === 0) return { success: true, processed: 0, updated: 0 };

    // Prepare Gemini prompt
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const qList = questions.map((q, i) => `Item ${i + 1}: ${q.text.substring(0, 300).replace(/\n/g, ' ')}...`).join('\n');
    const validSectionList = validSections.map(s => `${s.code} (${s.name})`).join(', ');

    const prompt = `
        You are an expert exam classifier. 
        I have a list of exam questions. 
        Classify each question into EXACTLY one of the following sections: [${validSectionList}].

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

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const jsonStr = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const classification = JSON.parse(jsonStr);

    // Update database
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
    return { success: true, processed: questions.length, updated: updatedCount };
}

export async function POST(req) {
    const client = await db.connect();
    try {
        // Find papers with sections that have more than 30 questions
        // LIMIT to 5 sections per run to avoid timeouts
        const query = `
            SELECT 
                ps.paper_session_id,
                ps.session_label,
                ps.exam_id,
                ps.paper_date,
                es.code as section_code,
                es.name as section_name,
                COUNT(qv.question_id) as question_count
            FROM paper_session ps
            JOIN question_version qv ON qv.paper_session_id = ps.paper_session_id
            JOIN exam_section es ON es.section_id = qv.exam_section_id
            GROUP BY ps.paper_session_id, ps.session_label, ps.exam_id, ps.paper_date, es.code, es.name
            HAVING COUNT(qv.question_id) > 30
            ORDER BY ps.paper_date DESC, question_count DESC
            LIMIT 5
        `;

        const oversizedRes = await client.query(query);
        const oversizedSections = oversizedRes.rows;

        if (oversizedSections.length === 0) {
            // Check if there are MORE papers beyond the limit
            const countQuery = `
                SELECT COUNT(DISTINCT ps.paper_session_id) as total
                FROM paper_session ps
                JOIN question_version qv ON qv.paper_session_id = ps.paper_session_id
                JOIN exam_section es ON es.section_id = qv.exam_section_id
                GROUP BY ps.paper_session_id, es.section_id
                HAVING COUNT(qv.question_id) > 30
            `;
            const countRes = await client.query(countQuery);
            const totalRemaining = parseInt(countRes.rows[0]?.total || 0);

            return NextResponse.json({
                success: true,
                message: 'No papers need reclassification',
                totalSections: 0,
                totalQuestionsUpdated: 0,
                details: [],
                remainingPapers: totalRemaining
            });
        }

        // 2. Reclassify each oversized section
        const results = [];
        for (const section of oversizedSections) {
            console.log(`Reclassifying ${section.session_label} - ${section.section_name} (${section.question_count} questions)`);

            const result = await reclassifySection(
                client,
                section.paper_session_id,
                section.section_code,
                section.exam_id
            );

            results.push({
                paper: section.session_label,
                section: section.section_name,
                originalCount: parseInt(section.question_count),
                ...result
            });
        }

        const totalProcessed = results.reduce((sum, r) => sum + (r.processed || 0), 0);
        const totalQuestionsUpdated = results.reduce((sum, r) => sum + (r.updated || 0), 0);

        // Count remaining papers that still need reclassification
        const remainingQuery = `
            SELECT COUNT(*) as total
            FROM (
                SELECT ps.paper_session_id
                FROM paper_session ps
                JOIN question_version qv ON qv.paper_session_id = ps.paper_session_id
                JOIN exam_section es ON es.section_id = qv.exam_section_id
                GROUP BY ps.paper_session_id, es.section_id
                HAVING COUNT(qv.question_id) > 30
            ) as oversized
        `;
        const remainingRes = await client.query(remainingQuery);
        const remainingPapers = parseInt(remainingRes.rows[0]?.total || 0);

        return NextResponse.json({
            success: true,
            message: `Processed ${results.length} section(s)`,
            totalSections: results.length,
            totalQuestionsUpdated,
            details: results,
            remainingPapers,
            moreToProcess: remainingPapers > 0
        });

    } catch (error) {
        console.error('Bulk reclassification error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
