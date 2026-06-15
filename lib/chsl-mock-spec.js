/**
 * SSC CHSL Tier 1 mock-test spec.
 *
 * Structurally identical to CGL T1 (4 sections × 25 Q = 100 Q, same section
 * codes REASONING / GA / QUANT / ENGLISH) so the topic targets, bucket maps,
 * difficulty profile, and group rules are inherited verbatim from cgl-mock-spec.
 *
 * What differs:
 *   - EXAM_ID points to SSC CHSL Tier 1 (mocks are written under this exam).
 *   - TARGET_SECTION_IDS point to CHSL's own section rows (writes land here).
 *   - BANK_SECTION_IDS stay the same as CGL's BANK_SECTION_IDS — the shared
 *     bank (source_type='bank') already lives under those four section_ids,
 *     so the picker pool is identical for CGL and CHSL.
 *
 * Anything CHSL-specific the team wants to diverge later (different topic
 * weightages, different difficulty profile, etc.) should be edited here only.
 */

import {
    SECTION_TOTAL,
    MOCK_TOTAL,
    PYQ_TARGET_PER_SECTION,
    PYQ_CAP_PER_SECTION,
    ALLOWED_SOURCE_TYPES,
    RC_MIN_PASSAGE_CHARS_DEFAULT,
    RC_MAX_PASSAGE_CHARS_DEFAULT,
    CLOZE_MIN_PASSAGE_CHARS_DEFAULT,
    CLOZE_MAX_PASSAGE_CHARS_DEFAULT,
    CA_SUBTYPES,
    CA_FRESHNESS_QUARTERS_DEFAULT,
    SECTION_SPEC,
    BUCKET_TOPICS,
    MAX_PER_TOPIC,
    SUBTYPE_PREFIXES,
    ALLOWED_DIFFICULTIES,
    DIFFICULTY_LEVELS,
    SECTION_DIFFICULTY_BASE,
    normalizeConfig,
    placeholderCountsBySection,
    normalizeDifficultyProfile,
    buildPlaceholderTemplates,
    BANK_SECTION_IDS,
} from './cgl-mock-spec.js';

// SSC CHSL Tier 1 exam
export const CHSL_T1_EXAM_ID = '45a8a693-b3e1-411e-8579-3e274b584f28';

// CHSL's own four section IDs (writes land here)
export const TARGET_SECTION_IDS = {
    REASONING: '03137dd2-302c-48fb-8bff-6cc1c7543500',
    GA:        '1838f918-a330-492d-a245-a0075471db9c',
    QUANT:     'e655c811-3b92-4c56-9e9d-b6b3c4d10174',
    ENGLISH:   'c713a37b-15f0-4608-aac5-eba9cf490ff8',
};

// CHSL section codes (kept identical to CGL so the picker logic carries over verbatim)
export const SECTION_CODES = ['REASONING', 'GA', 'QUANT', 'ENGLISH'];

// PYQ source filter — null means "any exam's PYQs are eligible".
// Override to a list of exam_ids if the team wants to restrict (e.g. avoid
// pulling CGL PYQs into CHSL mocks).
export const PYQ_EXAM_IDS = null;

// Re-export the shared values so callers can pull everything via a single spec object
export {
    SECTION_TOTAL,
    MOCK_TOTAL,
    PYQ_TARGET_PER_SECTION,
    PYQ_CAP_PER_SECTION,
    ALLOWED_SOURCE_TYPES,
    RC_MIN_PASSAGE_CHARS_DEFAULT,
    RC_MAX_PASSAGE_CHARS_DEFAULT,
    CLOZE_MIN_PASSAGE_CHARS_DEFAULT,
    CLOZE_MAX_PASSAGE_CHARS_DEFAULT,
    CA_SUBTYPES,
    CA_FRESHNESS_QUARTERS_DEFAULT,
    SECTION_SPEC,
    BUCKET_TOPICS,
    MAX_PER_TOPIC,
    SUBTYPE_PREFIXES,
    ALLOWED_DIFFICULTIES,
    DIFFICULTY_LEVELS,
    SECTION_DIFFICULTY_BASE,
    normalizeConfig,
    placeholderCountsBySection,
    normalizeDifficultyProfile,
    buildPlaceholderTemplates,
    BANK_SECTION_IDS,
};
