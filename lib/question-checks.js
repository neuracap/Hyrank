/**
 * Shared question quality checks — used by Dashboard, SolutionReview, SolutionReviewBilingual.
 * Returns an array of warning strings for a given question.
 */

const FORBIDDEN_PHRASES = [
    'Question ID', 'Question ID:', 'Status :', 'Click Here', 'Challenge',
    'Question No.', 'https://', 'Not provided in the source', 'Not Available',
    'Chosen Option', 'Not Answered', 'Marked For Review', 'Not Visited',
    'Status : Answered', 'Question Palette',
];

const IMAGE_KEYWORDS = /\b(mirror|image|figure|diagram|picture|graph|table|chart|map|given below|shown below|refer to|as shown|adjacent figure|following figure)\b/i;

const HAS_IMAGE_TAG = (text) => /\\includegraphics|!\[.*?\]\(.*?\)|\.jpg|\.png|\.jpeg|\.gif|\.svg/.test(text || '');

const RAW_IMAGE_REF = /\.(jpg|jpeg|png|gif|svg)\b/i;

/**
 * Run all quality checks on a question.
 * @param {string} questionText - the question body text
 * @param {Array} options - array of {option_key/opt_label, opt_text}
 * @param {string} correctAnswer - the correct option label (A/B/C/D) or null
 * @returns {Array<{type: string, message: string, severity: 'error'|'warning'}>}
 */
export function checkQuestionQuality(questionText, options = [], correctAnswer = null) {
    const warnings = [];
    const text = questionText || '';
    const opts = options || [];

    // 1. Empty question text
    if (!text.trim()) {
        warnings.push({ type: 'empty_question', message: 'Question text is empty', severity: 'error' });
    }

    // 2. Very short question text (likely garbage)
    if (text.trim().length > 0 && text.trim().length < 10) {
        warnings.push({ type: 'short_question', message: 'Question text suspiciously short (<10 chars)', severity: 'warning' });
    }

    // 3. Blank options
    const blankOpts = opts.filter(o => !o.opt_text || !o.opt_text.trim());
    if (blankOpts.length > 0) {
        const labels = blankOpts.map(o => o.option_key || o.opt_label).join(', ');
        warnings.push({ type: 'blank_option', message: `Blank option(s): ${labels}`, severity: 'error' });
    }

    // 4. Less than 4 options
    if (opts.length < 4) {
        warnings.push({ type: 'missing_options', message: `Only ${opts.length} option(s) — expected 4`, severity: 'error' });
    }

    // 5. Forbidden/suspicious text in question
    const hasForbidden = (t) => t && FORBIDDEN_PHRASES.some(p => t.includes(p));
    if (hasForbidden(text)) {
        warnings.push({ type: 'forbidden_text', message: 'Question contains suspicious text (Question ID, Status, etc.)', severity: 'error' });
    }

    // 6. Forbidden text in options
    const badOpts = opts.filter(o => hasForbidden(o.opt_text));
    if (badOpts.length > 0) {
        const labels = badOpts.map(o => o.option_key || o.opt_label).join(', ');
        warnings.push({ type: 'forbidden_option', message: `Option ${labels} contains suspicious text`, severity: 'error' });
    }

    // 7. Duplicate option text
    const optTexts = opts.map(o => (o.opt_text || '').trim().toLowerCase()).filter(t => t.length > 0);
    const seen = new Set();
    const dupes = new Set();
    for (const t of optTexts) {
        if (seen.has(t)) dupes.add(t);
        seen.add(t);
    }
    if (dupes.size > 0) {
        warnings.push({ type: 'duplicate_options', message: 'Duplicate option text detected', severity: 'warning' });
    }

    // 8. Missing image — text mentions figure/diagram but no image tag
    const questionHasImage = HAS_IMAGE_TAG(text) || opts.some(o => HAS_IMAGE_TAG(o.opt_text));
    if (IMAGE_KEYWORDS.test(text) && !questionHasImage) {
        warnings.push({ type: 'missing_image', message: 'Text mentions figure/diagram but no image found', severity: 'warning' });
    }

    // 9. Raw image file reference in text
    if (RAW_IMAGE_REF.test(text)) {
        warnings.push({ type: 'raw_image_ref', message: 'Question has raw image file reference (.jpg/.png)', severity: 'warning' });
    }

    // 10. No correct answer set
    if (!correctAnswer) {
        warnings.push({ type: 'no_correct_answer', message: 'No correct answer set', severity: 'warning' });
    }

    // 11. All options identical (all same text)
    if (opts.length >= 4 && optTexts.length >= 4) {
        const unique = new Set(optTexts);
        if (unique.size === 1) {
            warnings.push({ type: 'all_same_options', message: 'All options have identical text', severity: 'error' });
        }
    }

    return warnings;
}

/**
 * Quick check: returns true if question has any errors (severity: 'error')
 */
export function hasQuestionError(questionText, options, correctAnswer) {
    return checkQuestionQuality(questionText, options, correctAnswer).some(w => w.severity === 'error');
}

/**
 * Quick check: returns true if question has any issues at all
 */
export function hasQuestionIssue(questionText, options, correctAnswer) {
    return checkQuestionQuality(questionText, options, correctAnswer).length > 0;
}
