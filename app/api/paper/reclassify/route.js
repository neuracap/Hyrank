import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Build the classification prompt — only includes the target sections, not all sections
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

// Apply Gemini classification results to the database
async function applyClassification(client, questions, classification, codeToIdMap) {
    await client.query('BEGIN');
    let updatedCount = 0;

    for (const key in classification) {
        const index = parseInt(key, 10) - 1;
        if (isNaN(index) || index < 0 || index >= questions.length) {
            console.warn(`Invalid index returned by LLM: ${key}`);
            continue;
        }

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
    return updatedCount;
}

export async function POST(req) {
    const client = await db.connect();
    try {
        const { paper_session_id, source_section, smart } = await req.json();

        if (!paper_session_id) {
            return NextResponse.json({ error: 'Missing paper_session_id' }, { status: 400 });
        }

        // 1. Fetch Exam ID, num_questions & Valid Sections
        const paperRes = await client.query(
            `SELECT ps.exam_id, e.num_questions
             FROM paper_session ps
             LEFT JOIN exam e ON ps.exam_id = e.exam_id
             WHERE ps.paper_session_id = $1`,
            [paper_session_id]
        );
        if (paperRes.rows.length === 0) return NextResponse.json({ error: 'Paper not found' }, { status: 404 });
        const { exam_id: examId, num_questions: numQuestions } = paperRes.rows[0];

        const sectionsRes = await client.query(
            'SELECT section_id, code, name FROM exam_section WHERE exam_id = $1',
            [examId]
        );
        const allSections = sectionsRes.rows;
        const codeToIdMap = allSections.reduce((acc, s) => ({ ...acc, [s.code]: s.section_id, [s.code.toLowerCase()]: s.section_id }), {});

        // 2. Smart mode: detect oversized/undersized sections automatically
        if (smart) {
            const expectedPerSection = numQuestions ? Math.round(numQuestions / allSections.length) : 25;
            const oversizeThreshold = expectedPerSection * 1.5;
            const undersizeThreshold = expectedPerSection * 0.5;

            // Get current distribution
            const distRes = await client.query(`
                SELECT es.section_id, es.code, es.name, COUNT(qv.question_id) as count
                FROM exam_section es
                LEFT JOIN question_version qv ON qv.exam_section_id = es.section_id AND qv.paper_session_id = $1
                WHERE es.exam_id = $2
                GROUP BY es.section_id, es.code, es.name
            `, [paper_session_id, examId]);

            const distribution = distRes.rows.map(r => ({ ...r, count: parseInt(r.count) }));
            const oversized = distribution.filter(d => d.count > oversizeThreshold);
            const undersized = distribution.filter(d => d.count < undersizeThreshold);

            if (oversized.length === 0) {
                return NextResponse.json({
                    success: true,
                    message: 'No oversized sections found — distribution looks balanced',
                    distribution: distribution.map(d => ({ code: d.code, name: d.name, count: d.count })),
                    expectedPerSection,
                    processed: 0
                });
            }

            // Target sections = oversized + undersized (only classify between these)
            const targetSections = [...oversized, ...undersized].map(d => allSections.find(s => s.section_id === d.section_id));

            // Fetch questions ONLY from oversized sections
            const oversizedIds = oversized.map(d => d.section_id);
            const questionsRes = await client.query(`
                SELECT question_id, body_json->>'text' as text
                FROM question_version
                WHERE paper_session_id = $1 AND exam_section_id = ANY($2)
            `, [paper_session_id, oversizedIds]);

            const questions = questionsRes.rows;
            if (questions.length === 0) {
                return NextResponse.json({ success: true, message: 'No questions to reclassify', processed: 0 });
            }

            // Call Gemini with only the target sections
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
            const prompt = buildPrompt(questions, targetSections);
            const result = await model.generateContent(prompt);
            const jsonStr = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            const classification = JSON.parse(jsonStr);

            const updatedCount = await applyClassification(client, questions, classification, codeToIdMap);

            return NextResponse.json({
                success: true,
                message: `Smart reclassified ${updatedCount} questions`,
                processed: questions.length,
                updated: updatedCount,
                oversizedSections: oversized.map(d => ({ code: d.code, count: d.count })),
                undersizedSections: undersized.map(d => ({ code: d.code, count: d.count })),
                targetSections: targetSections.map(s => s.code)
            });
        }

        // 3. Legacy mode: reclassify a specific section (or all) into all sections
        let query = `
            SELECT question_id, body_json->>'text' as text
            FROM question_version
            WHERE paper_session_id = $1
        `;
        const params = [paper_session_id];

        if (source_section) {
            const targetId = codeToIdMap[source_section] ||
                codeToIdMap[source_section.toLowerCase()] ||
                allSections.find(s => s.name === source_section)?.section_id;

            if (targetId) {
                query += ` AND exam_section_id = $2`;
                params.push(targetId);
            } else {
                query += ` AND (meta_json->>'section_name' = $2 OR meta_json->>'section_name' ILIKE $2)`;
                params.push(source_section);
            }
        }

        const questionsRes = await client.query(query, params);
        const questions = questionsRes.rows;

        if (questions.length === 0) {
            return NextResponse.json({ success: true, message: 'No questions found to reclassify', processed: 0 });
        }

        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const prompt = buildPrompt(questions, allSections);
        const result = await model.generateContent(prompt);
        const jsonStr = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const classification = JSON.parse(jsonStr);

        const updatedCount = await applyClassification(client, questions, classification, codeToIdMap);

        return NextResponse.json({
            success: true,
            message: `Reclassified ${updatedCount} questions`,
            processed: questions.length,
            updated: updatedCount
        });

    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error reclassifying:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
