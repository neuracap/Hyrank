// =========================================================
// Gemini batch solution response parser + language quality check
// Ported from Python batch worker
// =========================================================

const DEVANAGARI_RE = /[\u0900-\u097F]/g;
const LATIN_RE = /[A-Za-z]/g;

const DIFFICULTY_MAP = { easy: 1, medium: 2, hard: 3 };

/**
 * Normalize an option label to A/B/C/D or ''.
 */
export function normalizeOptionLabel(raw) {
    if (raw == null) return '';
    let s = String(raw).trim().toUpperCase();
    if (['A', 'B', 'C', 'D'].includes(s)) return s;
    s = s.replace(/[^A-Z]/g, '');
    if (['A', 'B', 'C', 'D'].includes(s)) return s;
    return '';
}

/**
 * Extract student-facing text from parsed solution data for language check.
 */
function extractStudentFacingText(data) {
    const parts = [];

    const ao = data.answer_outcome || {};
    if (typeof ao.core_answer_basis === 'string') parts.push(ao.core_answer_basis);

    for (const sec of (data.display_sections || [])) {
        if (sec && typeof sec.content === 'string') parts.push(sec.content);
    }

    const ls = data.learning_signals || {};
    for (const item of (ls.takeaways || [])) {
        if (typeof item === 'string') parts.push(item);
    }
    for (const item of (ls.memory_hooks || [])) {
        if (typeof item === 'string') parts.push(item);
    }

    return parts.join('\n');
}

/**
 * Check if the response language matches expected language.
 * Hindi responses must contain Devanagari text (except for English section in HI mode).
 */
export function languageQualityCheck(expectedLanguage, section, data) {
    const lang = (expectedLanguage || 'EN').toUpperCase();
    const sec = (section || '').toLowerCase();
    const text = extractStudentFacingText(data);

    const devanagariCount = (text.match(DEVANAGARI_RE) || []).length;
    const latinCount = (text.match(LATIN_RE) || []).length;

    // English medium: no check needed
    if (lang === 'EN') {
        return { isOk: true, reason: '', devanagariCount, latinCount };
    }

    // Hindi medium but English section: skip strict validation
    if (lang === 'HI' && sec === 'english') {
        return { isOk: true, reason: 'skipped_for_hindi_english_section', devanagariCount, latinCount };
    }

    // Hindi medium for non-English sections: require meaningful Devanagari
    if (lang === 'HI') {
        if (devanagariCount < 20 && latinCount > devanagariCount) {
            return { isOk: false, reason: 'visible_output_not_in_hindi', devanagariCount, latinCount };
        }
    }

    return { isOk: true, reason: '', devanagariCount, latinCount };
}

/**
 * Parse a Gemini batch response text into structured solution data.
 * Returns { success, data?, error? }
 */
export function parseSolutionResponse(responseText, expectedLanguage, section) {
    let data;
    try {
        data = JSON.parse(responseText);
    } catch {
        // Try stripping markdown fences
        const cleaned = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        try {
            data = JSON.parse(cleaned);
        } catch (e2) {
            return { success: false, error: `JSON parse error: ${e2.message}` };
        }
    }

    const qi = data.question_identity || {};
    const ao = data.answer_outcome || {};

    const subtype = String(qi.subtype || '').trim();
    const difficulty = String(qi.difficulty || '').trim().toLowerCase();
    const difficultySmallint = DIFFICULTY_MAP[difficulty] || null;

    const correctOption = normalizeOptionLabel(ao.correct_option);
    const finalAnswerText = String(ao.final_answer_text || '').trim();
    const recheckOptions = Boolean(ao.recheck_options);
    const figureHelpful = Boolean(ao.figure_helpful);
    const figurePrompt = String(ao.figure_prompt || '').trim();

    // Clean display_sections
    const displaySections = [];
    for (const sec of (data.display_sections || [])) {
        if (!sec || typeof sec !== 'object') continue;
        const key = String(sec.key || '').trim();
        const content = String(sec.content || '').trim();
        if (key && content) displaySections.push({ key, content });
    }
    data.display_sections = displaySections;

    // Language quality check
    const sectionKey = (section || qi.section || '').toLowerCase();
    const langCheck = languageQualityCheck(expectedLanguage, sectionKey, data);
    data.language_check = langCheck;

    if (!langCheck.isOk) {
        return {
            success: false,
            error: `Language validation failed: ${langCheck.reason}`,
            languageCheck: langCheck,
        };
    }

    return {
        success: true,
        data: {
            fullJson: data,
            subtype,
            difficultySmallint,
            correctOptionLabel: correctOption,
            finalAnswerText,
            recheckOptions,
            figureHelpful,
            figurePrompt,
            languageCheck: langCheck,
        },
    };
}
