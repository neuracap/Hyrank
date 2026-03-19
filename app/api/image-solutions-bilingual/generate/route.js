import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SUBTYPES = [
    'visual_series', 'coding_decoding', 'venn_diagram', 'embedded_figure',
    'mirror_image', 'paper_folding', 'count_polygons', 'cube_dice', 'other'
];

function buildPrompt({ question_text, options, correct_option_label, reviewer_solution_en, reviewer_solution_hi, subtype, exam_name, section }) {
    const optionsStr = (options || [])
        .map(o => `${o.opt_label}) ${o.opt_text || '(image-based)'}`)
        .join('\n');

    return `You are an expert competitive-exam tutor for Indian government exams (UPSC, SSC, Banking, Railways).

A reviewer has already solved this question. Your job is to structure their answer into a rich JSON format.
**DO NOT change the correct answer or the reviewer's explanation.** Use them as-is.

## Question
${question_text || '(image-based question)'}

## Options
${optionsStr}

## Reviewer's Answer
- **Correct Option:** ${correct_option_label}
- **Subtype:** ${subtype || 'other'}
- **Exam:** ${exam_name || 'SSC'}
- **Section:** ${section || 'General Intelligence and Reasoning'}

## Reviewer's Explanation (English)
${reviewer_solution_en || '(none provided)'}

## Reviewer's Explanation (Hindi)
${reviewer_solution_hi || '(none provided)'}

## Instructions
Return ONLY a valid JSON object (no markdown fences) with these exact keys.
The exam_craft.approach MUST use the reviewer's explanation verbatim. Do not rewrite it.

{
  "correct_option_label": "${correct_option_label}",
  "final_answer_text": "Brief one-line answer",
  "difficulty": "easy|medium|hard",
  "subtype": "${subtype || 'other'}",
  "recheck_options": false,
  "figure_helpful": true,
  "figure_prompt": null,
  "display_sections": {
    "exam_craft": {
      "title": "Solution",
      "approach": "(USE REVIEWER'S ENGLISH EXPLANATION HERE VERBATIM)",
      "approach_hi": "(USE REVIEWER'S HINDI EXPLANATION HERE VERBATIM)",
      "key_concept": "The core concept being tested",
      "shortcut": null,
      "time_estimate_seconds": 30
    },
    "diagnostic_signals": {
      "title": "Diagnostic Signals",
      "topic_chain": ["Reasoning", "${subtype || 'Visual Reasoning'}", "specific concept"],
      "bloom_level": "apply",
      "skill_tested": "What skill this tests"
    },
    "learning_signals": {
      "title": "Learning Signals",
      "prerequisite_concepts": ["concept1"],
      "related_questions_hint": "Related question types",
      "mnemonic": null
    },
    "student_errors": {
      "title": "Common Student Errors",
      "common_mistakes": ["mistake1"],
      "option_error_map": {
        "A": "Why students pick A (null if correct)",
        "B": "Why students pick B",
        "C": "Why students pick C",
        "D": "Why students pick D"
      }
    },
    "quality_check": {
      "title": "Quality Check",
      "issue_flag": false,
      "issues": [],
      "suggested_fix": null
    }
  },
  "metadata_tags": {
    "subject": "General Intelligence and Reasoning",
    "topic": "${subtype || 'Visual Reasoning'}",
    "subtopic": "specific subtopic",
    "exam_relevance": ["SSC CGL", "SSC CHSL"]
  }
}`;
}

function parseDifficulty(val) {
    if (!val) return null;
    const map = { easy: 1, medium: 2, hard: 3 };
    return map[val.toLowerCase()] || null;
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

    const { question_text, options, correct_option_label, reviewer_solution_en, reviewer_solution_hi, subtype, exam_name, section } = body;

    if (!correct_option_label) {
        return NextResponse.json({ error: 'correct_option_label is required' }, { status: 400 });
    }

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const prompt = buildPrompt({ question_text, options, correct_option_label, reviewer_solution_en, reviewer_solution_hi, subtype, exam_name, section });

        const result = await model.generateContent(prompt);
        const rawText = result.response.text();

        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch {
            const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            parsed = JSON.parse(cleaned);
        }

        // Enforce reviewer's answer — AI must not override
        parsed.correct_option_label = correct_option_label;
        parsed.subtype = subtype || parsed.subtype;

        return NextResponse.json({
            success: true,
            parsed: {
                full_json: parsed,
                subtype: parsed.subtype || null,
                difficulty: parseDifficulty(parsed.difficulty),
                difficulty_label: parsed.difficulty || null,
                correct_option_label: parsed.correct_option_label,
                final_answer_text: parsed.final_answer_text || null,
                recheck_options: parsed.recheck_options || false,
                figure_helpful: parsed.figure_helpful || false,
                figure_prompt: parsed.figure_prompt || null,
            },
        });

    } catch (error) {
        console.error('image-solutions-bilingual/generate error:', error);
        return NextResponse.json({ error: 'AI generation failed', details: error.message }, { status: 500 });
    }
}
