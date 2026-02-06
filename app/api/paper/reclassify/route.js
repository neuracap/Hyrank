import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function POST(req) {
    const client = await db.connect();
    try {
        const { paper_session_id, source_section } = await req.json();

        if (!paper_session_id) {
            return NextResponse.json({ error: 'Missing paper_session_id' }, { status: 400 });
        }

        // 1. Fetch Exam ID & Valid Sections
        const paperRes = await client.query(
            'SELECT exam_id FROM paper_session WHERE paper_session_id = $1',
            [paper_session_id]
        );
        if (paperRes.rows.length === 0) return NextResponse.json({ error: 'Paper not found' }, { status: 404 });
        const examId = paperRes.rows[0].exam_id;

        const sectionsRes = await client.query(
            'SELECT section_id, code, name FROM exam_section WHERE exam_id = $1',
            [examId]
        );
        const validSections = sectionsRes.rows;
        const validCodes = validSections.map(s => s.code);
        const codeToIdMap = validSections.reduce((acc, s) => ({ ...acc, [s.code]: s.section_id, [s.code.toLowerCase()]: s.section_id }), {});
        const codeToNameMap = validSections.reduce((acc, s) => ({ ...acc, [s.code]: s.name, [s.code.toLowerCase()]: s.name }), {});

        // 2. Fetch Questions to Reclassify
        let query = `
            SELECT question_id, body_json->>'text' as text
            FROM question_version
            WHERE paper_session_id = $1
        `;
        const params = [paper_session_id];

        if (source_section) {
            // Find the section ID first, as meta_json.section_name is unreliable (contains full name, code, etc)
            // User likely passed the "name" or "code" from the UI.
            const targetId = codeToIdMap[source_section] ||
                codeToIdMap[source_section.toLowerCase()] ||
                validSections.find(s => s.name === source_section)?.section_id;

            if (targetId) {
                query += ` AND exam_section_id = $2`;
                params.push(targetId);
            } else {
                // Fallback to loose name match if ID lookup fails
                query += ` AND (meta_json->>'section_name' = $2 OR meta_json->>'section_name' ILIKE $2)`;
                params.push(source_section);
            }
        }

        const questionsRes = await client.query(query, params);
        let questions = questionsRes.rows;

        if (questions.length === 0) {
            return NextResponse.json({ success: true, message: 'No questions found to reclassify', processed: 0 });
        }

        // 3. Prepare Prompt for Gemini
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

        // Batching? If we have 50 questions, one prompt is likely fine for Flash 2.0 context window.
        // Construct a list using simpler indices to avoid UUID hallucination
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

        // Clean markdown if present
        const jsonStr = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const classification = JSON.parse(jsonStr);

        // 4. Update Database
        await client.query('BEGIN');
        let updatedCount = 0;

        for (const key in classification) {
            // key is "1", "2", etc.
            const index = parseInt(key, 10) - 1;

            if (isNaN(index) || index < 0 || index >= questions.length) {
                console.warn(`Invalid index returned by LLM: ${key}`);
                continue;
            }

            const questionId = questions[index].question_id;
            const newCode = classification[key];
            const newSectionId = codeToIdMap[newCode] || codeToIdMap[newCode.toUpperCase()];

            if (newSectionId) {
                // Update
                const currentRes = await client.query('SELECT meta_json FROM question_version WHERE question_id = $1', [questionId]);
                if (currentRes.rows.length > 0) {
                    const meta = currentRes.rows[0].meta_json || {};
                    // Use CODE as the section_name per user request
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

        return NextResponse.json({
            success: true,
            message: `Reclassified ${updatedCount} questions`,
            processed: questions.length,
            updated: updatedCount
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error reclassifying:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
