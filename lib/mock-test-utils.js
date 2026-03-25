// =========================================================
// Mock Test — shared utilities
// =========================================================

/**
 * Derive source_type from question data.
 * PYQ = has paper_session_id (parsed from a real exam paper)
 * Otherwise derive from meta_json.source
 */
export function deriveSourceType(paperSessionId, metaJson) {
    if (paperSessionId) return 'pyq';
    const src = (metaJson?.source || '').toLowerCase();
    if (src === 'llm') return 'llm';
    if (src === 'mock') return 'mock';
    if (src === 'manual') return 'manual';
    return 'unknown';
}

/**
 * Score a candidate question for a slot.
 * Higher score = better fit.
 */
export function scoreCandidate(q, slot, alreadySelectedPaperIds, alreadySelectedAnswers) {
    let score = 0;

    // 1. Exact subtype match (most important)
    if (q.subtype === slot.subtype) score += 10;

    // 2. Difficulty match
    const diffMap = { easy: 1, medium: 2, hard: 3 };
    const targetDiff = diffMap[slot.preferred_difficulty] || 2;
    if (q.difficulty === targetDiff) score += 5;
    else if (Math.abs(q.difficulty - targetDiff) === 1) score += 2;

    // 3. Quality signals
    if (q.is_verified) score += 3;
    if (!q.issue_flag) score += 2;

    // 4. Source diversity — penalize if we already have questions from same paper
    if (q.paper_session_id && alreadySelectedPaperIds.has(q.paper_session_id)) {
        score -= 3;
    }

    // 5. Answer balance — slightly prefer answers we have fewer of
    if (q.correct_option_label && alreadySelectedAnswers) {
        const counts = alreadySelectedAnswers;
        const thisCount = counts[q.correct_option_label] || 0;
        const minCount = Math.min(...Object.values(counts), 0);
        if (thisCount <= minCount) score += 2;
        else if (thisCount >= 8) score -= 2; // too many of this answer
    }

    // 6. Small random factor for variety
    score += Math.random() * 2;

    return score;
}

/**
 * Pick the best N candidates from a pool using scoring.
 */
export function pickBest(pool, count, slot, alreadySelectedPaperIds, alreadySelectedAnswers, excludeIds) {
    const eligible = pool.filter(q => !excludeIds.has(q.question_id));
    const scored = eligible.map(q => ({
        ...q,
        _score: scoreCandidate(q, slot, alreadySelectedPaperIds, alreadySelectedAnswers),
    }));
    scored.sort((a, b) => b._score - a._score);
    return scored.slice(0, count);
}

/**
 * Check difficulty distribution against targets.
 * Returns { ok, easy, medium, hard, issues[] }
 */
export function checkDifficultyDistribution(questions, targets) {
    const counts = { easy: 0, medium: 0, hard: 0 };
    for (const q of questions) {
        if (q.difficulty === 1) counts.easy++;
        else if (q.difficulty === 2) counts.medium++;
        else if (q.difficulty === 3) counts.hard++;
    }

    const issues = [];
    for (const [level, range] of Object.entries(targets || {})) {
        const count = counts[level] || 0;
        if (range.min != null && count < range.min) {
            issues.push(`${level}: ${count} < min ${range.min}`);
        }
        if (range.max != null && count > range.max) {
            issues.push(`${level}: ${count} > max ${range.max}`);
        }
    }

    return { ok: issues.length === 0, ...counts, issues };
}

/**
 * Check answer key balance for a set of questions.
 * Returns { ok, distribution, issues[] }
 */
export function checkAnswerBalance(questions) {
    const dist = { A: 0, B: 0, C: 0, D: 0 };
    for (const q of questions) {
        const opt = (q.correct_option_label || '').toUpperCase();
        if (dist[opt] !== undefined) dist[opt]++;
    }

    const total = questions.length;
    const issues = [];
    const threshold = total * 0.35; // no single option > 35%
    for (const [opt, count] of Object.entries(dist)) {
        if (count > threshold) {
            issues.push(`Option ${opt} has ${count}/${total} (${Math.round(count/total*100)}%) — exceeds 35%`);
        }
    }

    return { ok: issues.length === 0, distribution: dist, issues };
}
