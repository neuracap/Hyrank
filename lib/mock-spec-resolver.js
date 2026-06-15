/**
 * Resolves a mock-test "examKey" into the matching spec module.
 *
 * Why this exists:
 *   The CGL mock-builder pipeline (10 API routes + 1 huge component) was
 *   originally hardcoded to lib/cgl-mock-spec. To support CHSL and GD without
 *   forking the pipeline, every route/component reads its spec through this
 *   resolver — defaulting to 'cgl-t1' so all pre-examKey callers keep working
 *   unchanged.
 *
 * Each spec module exports the same shape: EXAM_ID (under a spec-specific
 * variable like CGL_T1_EXAM_ID / CHSL_T1_EXAM_ID / GD_EXAM_ID), TARGET_SECTION_IDS,
 * BANK_SECTION_IDS, SECTION_CODES, SECTION_TOTAL, SECTION_SPEC, SUBTYPE_PREFIXES,
 * BUCKET_TOPICS, MAX_PER_TOPIC, SECTION_DIFFICULTY_BASE, plus the normalize*
 * helpers.
 *
 * To make call-sites uniform, getSpec also exposes an `examId` getter that
 * picks the right id field from the underlying module.
 */

import * as cgl  from './cgl-mock-spec.js';
import * as chsl from './chsl-mock-spec.js';
import * as gd   from './gd-mock-spec.js';

const REGISTRY = {
    'cgl-t1': {
        module: cgl,
        examId: cgl.CGL_T1_EXAM_ID,
        displayName: 'SSC CGL Tier 1',
        slug: 'cgl-t1',
        builderTag: 'cgl-mock-builder',
    },
    'chsl-t1': {
        module: chsl,
        examId: chsl.CHSL_T1_EXAM_ID,
        displayName: 'SSC CHSL Tier 1',
        slug: 'chsl-t1',
        builderTag: 'chsl-mock-builder',
    },
    'gd': {
        module: gd,
        examId: gd.GD_EXAM_ID,
        displayName: 'SSC GD Constable',
        slug: 'gd',
        builderTag: 'gd-mock-builder',
    },
};

export const VALID_EXAM_KEYS = Object.keys(REGISTRY);

/**
 * Resolve a spec by examKey. Defaults to 'cgl-t1' so legacy callers that don't
 * pass an examKey keep working.
 *
 * Returns an object whose shape is `{ ...module, examId, examKey, displayName, slug }`.
 * Spread-merging the underlying module keeps every existing import name available
 * (SECTION_CODES, TARGET_SECTION_IDS, SECTION_SPEC, etc.).
 */
export function getSpec(examKey) {
    const key = examKey && REGISTRY[examKey] ? examKey : 'cgl-t1';
    const entry = REGISTRY[key];
    return {
        ...entry.module,
        examId: entry.examId,
        examKey: key,
        displayName: entry.displayName,
        slug: entry.slug,
        builderTag: entry.builderTag,
    };
}

export function isValidExamKey(examKey) {
    return Boolean(examKey && REGISTRY[examKey]);
}

/**
 * Look up a spec by exam_id (uuid). Used by routes that already know which
 * mock they're operating on — they can derive the right spec from the mock's
 * exam_id without trusting a client-supplied examKey. Returns null when no
 * registry entry matches (caller should fall back to CGL).
 */
export function getSpecByExamId(examId) {
    if (!examId) return null;
    for (const key of Object.keys(REGISTRY)) {
        if (REGISTRY[key].examId === examId) return getSpec(key);
    }
    return null;
}
