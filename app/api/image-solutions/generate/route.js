import { getCurrentUser } from '@/lib/auth-edge';
import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const REASONING_PROMPT = `You are an expert competitive-exam tutor for Indian government exams (UPSC, SSC, Banking, Railways).

## Task
Solve the following MCQ and produce a **structured JSON** response.

**Question ID:** {{question_id}}
**Language:** {{language}}
**Section:** {{section}}
**Exam:** {{exam_name}}

**Question Stem:**
{{question_stem}}

**Options:**
{{options}}

{{reviewer_notes}}

## Response Language
- If Language is "HI", write ALL student-facing text in Hindi (Devanagari script). Use English only for technical terms, formulas, or proper nouns.
- If Language is "EN", write ALL student-facing text in English.
- Field names/keys must always be in English regardless of language.

## Required JSON Structure
Return ONLY a valid JSON object (no markdown fences, no extra text) with these exact keys:

{
  "correct_option_label": "A|B|C|D",
  "final_answer_text": "Brief statement of the correct answer",
  "difficulty": "easy|medium|hard",
  "subtype": "factual|conceptual|calculation|application|analysis|comprehension|vocabulary|grammar|reasoning|data_interpretation",
  "recheck_options": true/false,
  "figure_helpful": true/false,
  "figure_prompt": "If figure_helpful is true, describe what figure/diagram would help explain this",
  "display_sections": {
    "exam_craft": {
      "title": "Solution",
      "approach": "Step-by-step approach to solve this question",
      "key_concept": "The core concept being tested",
      "shortcut": "Any exam shortcut or trick (null if none)",
      "time_estimate_seconds": 30
    },
    "diagnostic_signals": {
      "title": "Diagnostic Signals",
      "topic_chain": ["broad topic", "sub-topic", "specific concept"],
      "bloom_level": "remember|understand|apply|analyze|evaluate|create",
      "skill_tested": "What skill this question tests"
    },
    "learning_signals": {
      "title": "Learning Signals",
      "prerequisite_concepts": ["concept1", "concept2"],
      "related_questions_hint": "What other question types test similar knowledge",
      "mnemonic": "Memory aid if applicable (null if none)"
    },
    "student_errors": {
      "title": "Common Student Errors",
      "common_mistakes": ["mistake1", "mistake2"],
      "option_error_map": {
        "A": "Why a student might incorrectly pick A (null if correct)",
        "B": "Why a student might incorrectly pick B",
        "C": "Why a student might incorrectly pick C",
        "D": "Why a student might incorrectly pick D"
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
    "subject": "subject area",
    "topic": "specific topic",
    "subtopic": "narrower subtopic",
    "exam_relevance": ["SSC CGL", "SSC CHSL"]
  }
}`;

function buildPrompt(params) {
    const { question_id, question_text, options, language, exam_name, section, reviewer_notes } = params;

    const optionsStr = (options || [])
        .map(o => `${o.opt_label}) ${o.opt_text || '(image-based option)'}`)
        .join('\n');

    let prompt = REASONING_PROMPT
        .replace('{{question_id}}', question_id)
        .replace('{{language}}', language || 'EN')
        .replace('{{section}}', section || 'General')
        .replace('{{exam_name}}', exam_name || 'Unknown Exam')
        .replace('{{question_stem}}', question_text || '(image-based question — see option context)')
        .replace('{{options}}', optionsStr);

    if (reviewer_notes) {
        prompt = prompt.replace('{{reviewer_notes}}', `**Reviewer Notes (additional context):** ${reviewer_notes}`);
    } else {
        prompt = prompt.replace('{{reviewer_notes}}', '');
    }

    return prompt;
}

function parseDifficulty(val) {
    if (!val) return null;
    const map = { easy: 1, medium: 2, hard: 3 };
    return map[val.toLowerCase()] || null;
}

function languageCheck(displaySections) {
    if (!displaySections) return 'unknown';
    const text = JSON.stringify(displaySections);
    const devanagari = (text.match(/[\u0900-\u097F]/g) || []).length;
    const latin = (text.match(/[a-zA-Z]/g) || []).length;
    if (devanagari === 0 && latin === 0) return 'unknown';
    if (devanagari > latin) return 'HI';
    return 'EN';
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

    const { question_id, version_no, language, question_text, options, exam_name, section, reviewer_notes } = body;
    if (!question_id) {
        return NextResponse.json({ error: 'question_id is required' }, { status: 400 });
    }

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const prompt = buildPrompt({ question_id, question_text, options, language, exam_name, section, reviewer_notes });

        const result = await model.generateContent(prompt);
        const rawText = result.response.text();

        // Parse JSON — strip markdown fences if present
        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch {
            const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            parsed = JSON.parse(cleaned);
        }

        const fullJson = parsed;
        const langCheck = languageCheck(parsed.display_sections);

        return NextResponse.json({
            success: true,
            parsed: {
                full_json: fullJson,
                subtype: parsed.subtype || null,
                difficulty: parseDifficulty(parsed.difficulty),
                difficulty_label: parsed.difficulty || null,
                correct_option_label: parsed.correct_option_label || null,
                final_answer_text: parsed.final_answer_text || null,
                recheck_options: parsed.recheck_options || false,
                figure_helpful: parsed.figure_helpful || false,
                figure_prompt: parsed.figure_prompt || null,
                language_check: langCheck,
            },
        });

    } catch (error) {
        console.error('image-solutions/generate error:', error);
        return NextResponse.json({ error: 'AI generation failed', details: error.message }, { status: 500 });
    }
}
