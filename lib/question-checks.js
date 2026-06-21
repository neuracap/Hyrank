/**
 * Shared question quality heuristics.
 *
 * Used by:
 *   - Dashboard, SolutionReview, NewSolutionReviewBilingual, ReviewProductionBilingual
 *
 * Three layers of checks:
 *   1. checkQuestionQuality(text, options, correct)   — single-side question
 *   2. checkSolutionQuality(side)                     — single-side solution
 *   3. checkBilingualPair(en, hi)                     — cross-language pair
 *
 * Each returns an array of issues:
 *   { type, message, severity: 'error' | 'warning' }
 *
 * Errors should block sign-off; warnings should be noticed but don't block.
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

const HTML_TAG_RE = /<\s*(br|p|div|span|table|tr|td|html|body|script|style)[\s>\/]/i;
const HTML_ENTITY_RE = /&(nbsp|amp|lt|gt|quot|#\d+);/i;

const DEVANAGARI_RE = /[ऀ-ॿ]/;

// Pull a plain-text solution string out of solution_json.display_sections.
// Handles both the array shape ([{key, content}]) and the legacy object
// shape ({ key: { approach } | string }).
function extractSolutionText(solutionJson) {
    if (!solutionJson) return '';
    const sections = solutionJson.display_sections;
    if (Array.isArray(sections)) {
        return sections.map(s => s?.content || '').filter(Boolean).join(' ');
    }
    if (sections && typeof sections === 'object') {
        return Object.values(sections).map(v => {
            if (typeof v === 'string') return v;
            return v?.approach || v?.content || '';
        }).filter(Boolean).join(' ');
    }
    return '';
}

// =========================================================
// 1. Question-level checks
// =========================================================
export function checkQuestionQuality(questionText, options = [], correctAnswer = null) {
    const warnings = [];
    const text = questionText || '';
    const opts = options || [];

    // Empty question text
    if (!text.trim()) {
        warnings.push({ type: 'empty_question', message: 'Question text is empty', severity: 'error' });
    }

    // Very short question text (likely garbage)
    if (text.trim().length > 0 && text.trim().length < 10) {
        warnings.push({ type: 'short_question', message: 'Question text suspiciously short (<10 chars)', severity: 'warning' });
    }

    // Blank options
    const blankOpts = opts.filter(o => !o.opt_text || !o.opt_text.trim());
    if (blankOpts.length > 0) {
        const labels = blankOpts.map(o => o.option_key || o.opt_label).join(', ');
        warnings.push({ type: 'blank_option', message: `Blank option(s): ${labels}`, severity: 'error' });
    }

    // Less than 4 options
    if (opts.length < 4) {
        warnings.push({ type: 'missing_options', message: `Only ${opts.length} option(s) — expected 4`, severity: 'error' });
    }

    // Forbidden/suspicious text in question
    const hasForbidden = (t) => t && FORBIDDEN_PHRASES.some(p => t.includes(p));
    if (hasForbidden(text)) {
        warnings.push({ type: 'forbidden_text', message: 'Question contains suspicious text (Question ID, Status, etc.)', severity: 'error' });
    }

    // Forbidden text in options
    const badOpts = opts.filter(o => hasForbidden(o.opt_text));
    if (badOpts.length > 0) {
        const labels = badOpts.map(o => o.option_key || o.opt_label).join(', ');
        warnings.push({ type: 'forbidden_option', message: `Option ${labels} contains suspicious text`, severity: 'error' });
    }

    // Duplicate option text
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

    // Missing image — text mentions figure/diagram but no image tag
    const questionHasImage = HAS_IMAGE_TAG(text) || opts.some(o => HAS_IMAGE_TAG(o.opt_text));
    if (IMAGE_KEYWORDS.test(text) && !questionHasImage) {
        warnings.push({ type: 'missing_image', message: 'Text mentions figure/diagram but no image found', severity: 'warning' });
    }

    // Raw image file reference in text
    if (RAW_IMAGE_REF.test(text)) {
        warnings.push({ type: 'raw_image_ref', message: 'Question has raw image file reference (.jpg/.png)', severity: 'warning' });
    }

    // No correct answer set — promoted from warning to ERROR so production
    // review can use this to flag the card.
    if (!correctAnswer) {
        warnings.push({ type: 'no_correct_answer', message: 'No correct answer set', severity: 'error' });
    }

    // All options identical (all same text)
    if (opts.length >= 4 && optTexts.length >= 4) {
        const unique = new Set(optTexts);
        if (unique.size === 1) {
            warnings.push({ type: 'all_same_options', message: 'All options have identical text', severity: 'error' });
        }
    }

    // Unbalanced LaTeX `$` delimiters in stem (odd count breaks rendering)
    const dollarCount = (text.match(/\$/g) || []).length;
    if (dollarCount > 0 && dollarCount % 2 !== 0) {
        warnings.push({ type: 'unbalanced_latex_stem', message: 'Unbalanced $ in stem — LaTeX will not render', severity: 'error' });
    }
    const badLatexOpts = opts.filter(o => {
        const c = ((o.opt_text || '').match(/\$/g) || []).length;
        return c > 0 && c % 2 !== 0;
    });
    if (badLatexOpts.length > 0) {
        const labels = badLatexOpts.map(o => o.option_key || o.opt_label).join(', ');
        warnings.push({ type: 'unbalanced_latex_option', message: `Unbalanced $ in option ${labels}`, severity: 'error' });
    }

    // Empty markdown image link `![](  )` — rendered but broken
    const isEmptyImg = (t) => /!\[[^\]]*\]\(\s*\)/.test(t || '');
    if (isEmptyImg(text) || opts.some(o => isEmptyImg(o.opt_text))) {
        warnings.push({ type: 'empty_image_link', message: 'Empty image link `![]()` in stem/options', severity: 'error' });
    }

    // Raw HTML or entities leaked from a paste — usually messy display.
    if (HTML_TAG_RE.test(text) || HTML_ENTITY_RE.test(text) ||
        opts.some(o => HTML_TAG_RE.test(o.opt_text) || HTML_ENTITY_RE.test(o.opt_text))) {
        warnings.push({ type: 'html_leaked', message: 'Raw HTML or entities present (likely paste residue)', severity: 'warning' });
    }

    // Single-character options when other options are real text — usually
    // an OCR artifact ("A) 2" treated as just "2", fine; but if other
    // options are full sentences and one is a lone "a", something dropped).
    const singletonOpts = opts.filter(o => (o.opt_text || '').trim().length === 1);
    const wordyOpts = opts.filter(o => (o.opt_text || '').trim().length > 8);
    if (singletonOpts.length > 0 && wordyOpts.length >= 2) {
        const labels = singletonOpts.map(o => o.option_key || o.opt_label).join(', ');
        warnings.push({ type: 'single_char_option', message: `Option ${labels} is a single character — likely truncated`, severity: 'warning' });
    }

    // Option length variance — one option dramatically longer (>5x) than
    // the shortest non-trivial one often means a paragraph leaked into it.
    const lens = opts.map(o => (o.opt_text || '').trim().length).filter(l => l >= 3);
    if (lens.length >= 4) {
        const lo = Math.min(...lens);
        const hi = Math.max(...lens);
        if (lo > 0 && hi / lo >= 6) {
            warnings.push({ type: 'option_length_variance', message: `Option lengths vary wildly (${lo} to ${hi} chars)`, severity: 'warning' });
        }
    }

    return warnings;
}

// =========================================================
// 2. Solution-level checks (per side)
// =========================================================
export function checkSolutionQuality(side) {
    const issues = [];
    if (!side) return issues;

    const sj = side.solution_json || {};
    const isDone = side.solution_status === 'DONE';
    const solText = extractSolutionText(sj);
    const trimmedSol = solText.trim();

    // Marked DONE but no solution body.
    if (isDone && !trimmedSol) {
        issues.push({ type: 'solution_empty', message: 'Marked DONE but solution body is empty', severity: 'error' });
    }

    // Stub solution (likely placeholder).
    if (isDone && trimmedSol.length > 0 && trimmedSol.length < 30) {
        issues.push({ type: 'solution_too_short', message: `Solution suspiciously short (${trimmedSol.length} chars)`, severity: 'warning' });
    }

    // Core answer basis missing — annoys students who scan the one-liner first.
    if (isDone && !(sj.answer_outcome?.core_answer_basis || '').trim()) {
        issues.push({ type: 'core_basis_empty', message: 'Core Answer Basis is empty', severity: 'warning' });
    }

    // AI flagged figure_helpful but no figure_url present.
    if (isDone && (side.figure_helpful || side.figure_prompt) && !sj.answer_outcome?.figure_url) {
        issues.push({ type: 'figure_missing', message: 'Solution flagged as needing a figure but none attached', severity: 'warning' });
    }

    // Solution mentions option E/F/G but the question only has A-D.
    const optCount = side.options?.length || 0;
    if (optCount > 0 && optCount <= 4 && /\b(?:option|opt\.?)\s*[EFGH]\b/i.test(solText)) {
        issues.push({ type: 'solution_invalid_option_ref', message: 'Solution mentions option beyond A–D', severity: 'warning' });
    }

    // Unbalanced LaTeX `$` inside the solution body.
    const dollarCount = (solText.match(/\$/g) || []).length;
    if (dollarCount > 0 && dollarCount % 2 !== 0) {
        issues.push({ type: 'unbalanced_latex_solution', message: 'Unbalanced $ in solution — LaTeX broken', severity: 'error' });
    }

    // Empty image link in solution body.
    if (/!\[[^\]]*\]\(\s*\)/.test(solText)) {
        issues.push({ type: 'solution_empty_image', message: 'Empty image link `![]()` in solution body', severity: 'error' });
    }

    return issues;
}

// =========================================================
// 3. Pair-level checks (bilingual)
// =========================================================
export function checkBilingualPair(en, hi) {
    const issues = [];

    if (!en && !hi) return issues;
    if (!en) {
        issues.push({ type: 'missing_en', message: 'No English counterpart linked', severity: 'warning' });
        return issues;
    }
    if (!hi) {
        issues.push({ type: 'missing_hi', message: 'No Hindi counterpart linked', severity: 'warning' });
        return issues;
    }

    // Question-number mismatch across the pair.
    const norm = (s) => (s || '').toString().replace(/\s+/g, '').replace(/^Q\.?/i, '');
    if (en.q_no && hi.q_no && norm(en.q_no) !== norm(hi.q_no)) {
        issues.push({ type: 'q_no_mismatch', message: `Question number mismatch: EN=${en.q_no} HI=${hi.q_no}`, severity: 'warning' });
    }

    // Subtype mismatch (RC vs GA etc).
    if (en.subtype && hi.subtype && en.subtype !== hi.subtype) {
        issues.push({ type: 'subtype_mismatch', message: `Subtype mismatch: EN=${en.subtype} HI=${hi.subtype}`, severity: 'warning' });
    }

    // Option-count mismatch is a real problem — answer key won't line up.
    const enOptCount = en.options?.length || 0;
    const hiOptCount = hi.options?.length || 0;
    if (enOptCount !== hiOptCount) {
        issues.push({ type: 'option_count_mismatch', message: `Option count differs: EN has ${enOptCount}, HI has ${hiOptCount}`, severity: 'error' });
    }

    // Stem length wildly different — translation likely partial or skipped.
    const enLen = (en.text || '').replace(/\s+/g, '').length;
    const hiLen = (hi.text || '').replace(/\s+/g, '').length;
    if (enLen >= 30 && hiLen >= 30) {
        const ratio = Math.max(enLen, hiLen) / Math.max(1, Math.min(enLen, hiLen));
        if (ratio >= 3) {
            issues.push({
                type: 'stem_length_diverged',
                message: `Stem length differs ${ratio.toFixed(1)}× (EN ${enLen} vs HI ${hiLen} chars) — likely partial translation`,
                severity: 'warning',
            });
        }
    }

    // Hindi side has no Devanagari at all — almost certainly untranslated.
    if (hi.text && hi.text.length >= 20 && !DEVANAGARI_RE.test(hi.text)) {
        issues.push({ type: 'hi_no_devanagari', message: 'Hindi side has no Devanagari script — likely untranslated', severity: 'error' });
    }

    // English side leaks heavy Devanagari — usually a mislabeled row.
    if (en.text && en.text.length >= 20) {
        const devChars = (en.text.match(/[ऀ-ॿ]/g) || []).length;
        if (devChars > en.text.length * 0.3) {
            issues.push({ type: 'en_has_devanagari', message: 'English side has heavy Devanagari — possibly mislabeled language', severity: 'warning' });
        }
    }

    // Solution status split — one side reviewed, the other not.
    const enDone = en.solution_status === 'DONE';
    const hiDone = hi.solution_status === 'DONE';
    if (enDone !== hiDone) {
        issues.push({
            type: 'solution_status_split',
            message: `Only ${enDone ? 'EN' : 'HI'} solution is DONE — other side still ${enDone ? hi.solution_status : en.solution_status || 'PENDING'}`,
            severity: 'warning',
        });
    }

    return issues;
}

// =========================================================
// Quick helpers (true/false)
// =========================================================
export function hasQuestionError(questionText, options, correctAnswer) {
    return checkQuestionQuality(questionText, options, correctAnswer).some(w => w.severity === 'error');
}

export function hasQuestionIssue(questionText, options, correctAnswer) {
    return checkQuestionQuality(questionText, options, correctAnswer).length > 0;
}

export function hasSolutionError(side) {
    return checkSolutionQuality(side).some(w => w.severity === 'error');
}

export function hasPairError(en, hi) {
    return checkBilingualPair(en, hi).some(w => w.severity === 'error');
}
