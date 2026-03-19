import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function buildPrompt({ question_id, language, question_text, options, correct_option, subtype, difficulty, exam_craft, exam_name, section }) {
    const optionsStr = (options || [])
        .map(o => `${o.opt_label}) ${o.opt_text || '(image-based)'}`)
        .join('\n');

    const langInstruction = language === 'HI'
        ? 'Respond in Hindi (Devanagari script). Use English only for technical terms, formulas, or proper nouns.'
        : 'Respond in English.';

    return `You are an expert competitive-exam tutor for Indian government exams (SSC, Banking, Railways, UPSC).

A reviewer has already solved this question. Structure their answer into the JSON schema below.
**DO NOT change the correct_option, subtype, or difficulty.** Use the reviewer's exam_craft explanation verbatim in display_sections.

${langInstruction}

## Input
question_id: ${question_id}
language: ${language || 'EN'}
subtype: ${subtype || 'other'}
difficulty: ${difficulty || 'medium'}
correct_option: ${correct_option}
exam_craft: ${exam_craft || '(none provided)'}

## Question
${question_text || '(image-based question)'}

## Options
${optionsStr}

## Instructions
Return ONLY a valid JSON object (no markdown fences, no extra text). Use this exact schema:

{
  "question_identity": {
    "question_id": "${question_id}",
    "section": "${section || 'reasoning'}",
    "subtype": "${subtype || 'other'}",
    "difficulty": "${difficulty || 'medium'}"
  },
  "answer_outcome": {
    "correct_option": "${correct_option}",
    "final_answer_text": "Brief one-line statement of the answer",
    "core_answer_basis": "The fundamental reason this is correct",
    "recheck_options": false,
    "figure_helpful": true,
    "figure_prompt": "Description of helpful figure, or null"
  },
  "display_sections": [
    { "key": "exam_craft", "content": "(USE THE REVIEWER'S exam_craft EXPLANATION VERBATIM HERE)" }
  ],
  "diagnostic_signals": {
    "mistake_patterns": ["pattern1", "pattern2"],
    "exam_skills_tested": ["skill1", "skill2"],
    "trap_type": ["trap description if any"]
  },
  "learning_signals": {
    "concepts": ["concept1", "concept2"],
    "takeaways": ["key takeaway 1"],
    "memory_hooks": ["mnemonic or memory aid if applicable"]
  },
  "student_diagnostic_hooks": {
    "likely_errors": ["common error 1"],
    "option_error_map": {
      "A": "Why students pick A (null if correct)",
      "B": "Why students pick B",
      "C": "Why students pick C",
      "D": "Why students pick D"
    }
  },
  "quality_check": {
    "issue_flag": false,
    "issue_type": [],
    "issue_note": ""
  },
  "indexing_metadata": {
    "keywords": ["keyword1", "keyword2"],
    "tags": ["tag1", "tag2"]
  }
}`;
}

function parseDifficulty(val) {
    if (!val) return null;
    const map = { easy: 1, medium: 2, hard: 3 };
    return map[String(val).toLowerCase()] || null;
}

export async function POST(request) {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.GEMINI_API_KEY) {
        return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { question_id, language, question_text, options, correct_option, subtype, difficulty, exam_craft, exam_name, section } = body;
    if (!question_id || !correct_option) {
        return NextResponse.json({ error: 'question_id and correct_option are required' }, { status: 400 });
    }

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const prompt = buildPrompt({ question_id, language, question_text, options, correct_option, subtype, difficulty, exam_craft, exam_name, section });

        const result = await model.generateContent(prompt);
        const rawText = result.response.text();

        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch {
            const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            parsed = JSON.parse(cleaned);
        }

        // Enforce reviewer values
        if (parsed.question_identity) {
            parsed.question_identity.question_id = question_id;
            parsed.question_identity.subtype = subtype || parsed.question_identity.subtype;
            parsed.question_identity.difficulty = difficulty || parsed.question_identity.difficulty;
        }
        if (parsed.answer_outcome) {
            parsed.answer_outcome.correct_option = correct_option;
        }

        const diff = parsed.question_identity?.difficulty || difficulty;

        return NextResponse.json({
            success: true,
            parsed: {
                full_json: parsed,
                subtype: parsed.question_identity?.subtype || subtype || null,
                difficulty: parseDifficulty(diff),
                difficulty_label: diff || null,
                correct_option_label: correct_option,
                final_answer_text: parsed.answer_outcome?.final_answer_text || null,
                recheck_options: parsed.answer_outcome?.recheck_options || false,
                figure_helpful: parsed.answer_outcome?.figure_helpful || false,
                figure_prompt: parsed.answer_outcome?.figure_prompt || null,
            },
        });

    } catch (error) {
        console.error('image-solutions/generate error:', error);
        return NextResponse.json({ error: 'AI generation failed', details: error.message }, { status: 500 });
    }
}
