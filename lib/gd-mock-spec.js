/**
 * SSC GD Constable mock-test spec.
 *
 * GD actually ships as TWO papers per mock — one English-medium and one
 * Hindi-medium — each 4 sections × 20 Q = 80 Q. The first three sections
 * (REASONING / GA / QUANT) are shared by translation; the 4th section is
 * either ENGLISH (English medium) or HINDI (Hindi medium).
 *
 * Storage shape: two paired `mock_test` rows linked via
 * `stats_json.paired_with` (with `stats_json.medium` = 'EN' or 'HI').
 * This spec drives only the English-medium build
 * (4 sections, 80 Q). The Hindi-medium pair is produced afterwards via
 * /api/gd-mock/[id]/translate-and-link (HI versions of the 60 shared
 * questions) + /api/gd-mock/[id]/create-hindi-pair (which adds 20 native
 * HINDI questions picked from the HINDI bank).
 *
 * Bucket / topic maps for REASONING / GA / QUANT / ENGLISH are inherited from
 * CGL spec to keep topic clustering behavior identical. Per-section targets
 * are scaled to 20 and can be tuned independently per exam.
 *
 * HINDI-only data — TARGET_SECTION_IDS.HINDI, BANK_SECTION_IDS.HINDI,
 * SECTION_SPEC.HINDI, SECTION_DIFFICULTY_BASE.HINDI, HINDI_BUCKET_TOPICS
 * — lives in this module too (direct lookups by the pair-creation flow);
 * it is NOT part of SECTION_CODES so the EN builder loops skip it.
 */

import {
    ALLOWED_SOURCE_TYPES,
    RC_MIN_PASSAGE_CHARS_DEFAULT,
    RC_MAX_PASSAGE_CHARS_DEFAULT,
    CLOZE_MIN_PASSAGE_CHARS_DEFAULT,
    CLOZE_MAX_PASSAGE_CHARS_DEFAULT,
    CA_SUBTYPES,
    CA_FRESHNESS_QUARTERS_DEFAULT,
    BUCKET_TOPICS as CGL_BUCKET_TOPICS,
    MAX_PER_TOPIC as CGL_MAX_PER_TOPIC,
    SUBTYPE_PREFIXES as CGL_SUBTYPE_PREFIXES,
    ALLOWED_DIFFICULTIES,
    DIFFICULTY_LEVELS,
} from './cgl-mock-spec.js';

// SSC GD Constable exam_id
export const GD_EXAM_ID = '06852e91-9c09-419d-829a-79eea5d296a4';

// CGL T1 exam_id — referenced when allowing CGL PYQs into GD mocks.
const CGL_T1_EXAM_ID = 'dab3d0fd-7a06-4bae-a9ac-0f14f2d57157';

// GD's own five section ids (writes land here)
export const TARGET_SECTION_IDS = {
    REASONING: 'cad0d299-b84c-4aed-9c2c-ed78e404231d',
    GA:        '9d3d887c-bfeb-446f-bb64-b804c2a06bf2',
    QUANT:     'a3518426-02ee-4c92-b053-5548e31d257e',
    ENGLISH:   '1882c0c1-2614-4653-9f41-695dfc773025',
    HINDI:     '008f0cb0-81ab-43d0-a4b9-08e5324e65c6',
};

// Bank source for the pool — REASONING/GA/QUANT/ENGLISH pull from the shared
// bank (source_type='bank' rows under CHSL's four section ids). HINDI has no
// shared bank yet, so the picker pulls from GD's own HINDI section.
export const BANK_SECTION_IDS = {
    REASONING: '03137dd2-302c-48fb-8bff-6cc1c7543500',
    GA:        '1838f918-a330-492d-a245-a0075471db9c',
    QUANT:     'e655c811-3b92-4c56-9e9d-b6b3c4d10174',
    ENGLISH:   'c713a37b-15f0-4608-aac5-eba9cf490ff8',
    HINDI:     '008f0cb0-81ab-43d0-a4b9-08e5324e65c6',
};

// English-medium build path uses these 4 sections (= 80 Q). HINDI is reachable
// only via the create-hindi-pair flow, which reads HINDI keys directly from
// the maps below (TARGET_SECTION_IDS.HINDI, SECTION_SPEC.HINDI, etc.).
export const SECTION_CODES = ['REASONING', 'GA', 'QUANT', 'ENGLISH'];

export const SECTION_TOTAL = 20;
export const MOCK_TOTAL = 80;

// PYQ source-exam restriction: only GD and CGL papers are eligible.
// CHSL is excluded — its difficulty profile is too high for the GD audience.
export const PYQ_EXAM_IDS = [GD_EXAM_ID, CGL_T1_EXAM_ID];

// 50% of 20 = 10 — matches CGL's percentage choice.
export const PYQ_TARGET_PER_SECTION = Math.floor(SECTION_TOTAL * 0.5);
export const PYQ_CAP_PER_SECTION = PYQ_TARGET_PER_SECTION;

// HINDI subtype prefix map. Pure-Hindi subtypes are matched against the
// HINDI section's pool by qv.subtype LIKE ANY ARRAY[...].
const HINDI_SUBTYPE_PREFIXES = {
    hindi_vocabulary: [
        'synonym%', 'antonym%', 'one_word_substitution%',
        'idiom_phrase%', 'proverb%',
        'shabd_yugm%', 'anekarthi%', 'tatsam_tadbhav%',
        'contextual_word_choice%', 'vocabulary_misc%',
    ],
    hindi_grammar: [
        'sentence_correction%', 'fill_in_the_blank%',
        'grammar_misc%', 'spelling%',
        'ling_vachan%', 'karak%', 'kal_kriya%',
        'sandhi%', 'samas%', 'vachya%',
    ],
    hindi_comprehension: [
        'reading_comprehension%', 'cloze_test%',
    ],
};

export const SUBTYPE_PREFIXES = {
    ...CGL_SUBTYPE_PREFIXES,
    ...HINDI_SUBTYPE_PREFIXES,
};

// Topic clustering for HINDI buckets.
const HINDI_BUCKET_TOPICS = {
    hindi_vocabulary: {
        synonym:             ['synonym%'],
        antonym:             ['antonym%'],
        one_word:            ['one_word_substitution%'],
        idiom_proverb:       ['idiom_phrase%', 'proverb%'],
        shabd_pairs:         ['shabd_yugm%', 'anekarthi%'],
        tatsam_tadbhav:      ['tatsam_tadbhav%'],
        contextual:          ['contextual_word_choice%', 'vocabulary_misc%'],
    },
    hindi_grammar: {
        sentence_correction: ['sentence_correction%'],
        fill_blanks:         ['fill_in_the_blank%'],
        ling_vachan:         ['ling_vachan%'],
        karak:               ['karak%'],
        kal_kriya:           ['kal_kriya%'],
        sandhi_samas:        ['sandhi%', 'samas%'],
        spelling:            ['spelling%'],
        grammar_misc:        ['grammar_misc%', 'vachya%'],
    },
    hindi_comprehension: {
        cloze:               ['cloze_test%'],
        rc:                  ['reading_comprehension%'],
    },
};

export const BUCKET_TOPICS = {
    ...CGL_BUCKET_TOPICS,
    ...HINDI_BUCKET_TOPICS,
};

export const MAX_PER_TOPIC = {
    ...CGL_MAX_PER_TOPIC,
    hindi_vocabulary:    2,
    hindi_grammar:       2,
    hindi_comprehension: 2,
};

/**
 * Per-section targets scaled to 20 questions each.
 * Each row sums to SECTION_TOTAL (20). Sections accept the same groups
 * (RC, CLOZE, DI) as CGL — sizes unchanged at 5 each.
 *
 * The team can tune these without touching the picker.
 */
export const SECTION_SPEC = {
    REASONING: {
        targets: {
            analogy: 2,
            odd_one_out: 2,
            series: 2,
            coding_decoding: 2,
            blood_relation: 2,
            direction_sense: 1,
            word_arrangement: 2,
            syllogism: 2,
            venn_diagram: 2,
            mathematical_operation: 1,
            missing_number: 2,
        },
        remainder_subtypes: ['cube_dice', 'arithmetic_reasoning'],
        groups: [],
    },
    GA: {
        targets: {
            history: 2,
            polity: 2,
            geography: 3,
            economics: 2,
            science_ga: 7,
            current_affairs: 4,
        },
        remainder_subtypes: ['science_ga', 'current_affairs'],
        groups: [],
    },
    QUANT: {
        targets: {
            arithmetic:    7,
            applied:       5,
            number_system: 2,
            advanced:      6,
        },
        di_absorbs_from: 'applied',
        groups: [
            { group_type: 'DI', count_if_true: 1, expected_size_min: 3, expected_size_max: 5,
              fallback_subtype_prefix: 'data_interpretation_' },
        ],
        remainder_subtypes: ['applied', 'arithmetic'],
    },
    ENGLISH: {
        targets: {
            parajumble: 2,
            vocabulary: 9,
            grammar:    9,
        },
        protected_targets: ['parajumble'],
        groups: [
            { group_type: 'RC',    count_if_true: 1, expected_size_min: 5, expected_size_max: 5,
              when_config: 'include_english_rc',
              prefer_composition: { L1: 1, L2: 3, L3: 1, L4: 0 } },
            { group_type: 'CLOZE', count_if_true: 1, expected_size_min: 5, expected_size_max: 5,
              when_config: 'include_english_cloze' },
        ],
        remainder_subtypes: ['vocabulary', 'grammar'],
    },
    HINDI: {
        // Targets sum to 20. Vocabulary + grammar dominant; cloze group is opt-in
        // and absorbs slots from comprehension when on.
        targets: {
            hindi_vocabulary:    7,
            hindi_grammar:       8,
            hindi_comprehension: 5,
        },
        groups: [
            { group_type: 'CLOZE', count_if_true: 1, expected_size_min: 5, expected_size_max: 5,
              when_config: 'include_hindi_cloze' },
        ],
        // When the cloze group is OFF, distribute leftover slots into these buckets.
        remainder_subtypes: ['hindi_vocabulary', 'hindi_grammar'],
    },
};

/**
 * Difficulty profile per section. GD leans easier than CGL/CHSL.
 * Each row sums to SECTION_TOTAL = 20.
 */
export const SECTION_DIFFICULTY_BASE = {
    REASONING: { L1: 4, L2: 12, L3: 4, L4: 0 },
    GA:        { L1: 4, L2: 12, L3: 4, L4: 0 },
    QUANT:     { L1: 3, L2: 12, L3: 5, L4: 0 },
    ENGLISH:   { L1: 5, L2: 11, L3: 4, L4: 0 },
    HINDI:     { L1: 5, L2: 12, L3: 3, L4: 0 },
};

/**
 * Normalize a mock configuration. Mirrors CGL spec's normalizeConfig but adds
 * include_hindi_cloze for the GD HINDI section.
 */
export function normalizeConfig(input) {
    return {
        include_english_rc:                Boolean(input?.include_english_rc),
        include_english_cloze:             Boolean(input?.include_english_cloze),
        include_quant_di:                  Boolean(input?.include_quant_di),
        include_hindi_cloze:               Boolean(input?.include_hindi_cloze),
        reasoning_img_placeholder_count:   Math.max(0, Math.min(10, parseInt(input?.reasoning_img_placeholder_count ?? 0, 10) || 0)),
        rc_min_passage_chars:              Math.max(0, Math.min(5000, parseInt(input?.rc_min_passage_chars ?? RC_MIN_PASSAGE_CHARS_DEFAULT, 10) || 0)),
        rc_max_passage_chars:              Math.max(100, Math.min(5000, parseInt(input?.rc_max_passage_chars ?? RC_MAX_PASSAGE_CHARS_DEFAULT, 10) || RC_MAX_PASSAGE_CHARS_DEFAULT)),
        cloze_min_passage_chars:           Math.max(0, Math.min(5000, parseInt(input?.cloze_min_passage_chars ?? CLOZE_MIN_PASSAGE_CHARS_DEFAULT, 10) || 0)),
        cloze_max_passage_chars:           Math.max(100, Math.min(5000, parseInt(input?.cloze_max_passage_chars ?? CLOZE_MAX_PASSAGE_CHARS_DEFAULT, 10) || CLOZE_MAX_PASSAGE_CHARS_DEFAULT)),
        ca_freshness_quarters:             Math.max(1, Math.min(20, parseInt(input?.ca_freshness_quarters ?? CA_FRESHNESS_QUARTERS_DEFAULT, 10) || CA_FRESHNESS_QUARTERS_DEFAULT)),
    };
}

export function placeholderCountsBySection(cfg) {
    return {
        REASONING: cfg.reasoning_img_placeholder_count,
        GA:        0,
        QUANT:     0,
        ENGLISH:   0,
        HINDI:     0,
    };
}

export function normalizeDifficultyProfile(input, cfg) {
    const phByCode = placeholderCountsBySection(cfg);
    const errors = [];
    const profile = {};
    for (const code of SECTION_CODES) {
        const base = SECTION_DIFFICULTY_BASE[code] || { L1: 0, L2: 0, L3: 0, L4: 0 };
        const inSec = input?.[code] || {};
        const row = {};
        for (const lvl of DIFFICULTY_LEVELS) {
            const key = `L${lvl}`;
            const raw = inSec[key];
            const n = raw == null ? base[key] : Math.max(0, parseInt(raw, 10) || 0);
            row[key] = n;
        }
        const expected = SECTION_TOTAL - (phByCode[code] || 0);
        const sum = row.L1 + row.L2 + row.L3 + row.L4;
        if (sum !== expected) {
            errors.push(`${code} difficulty row sums to ${sum} but should be ${expected} (${SECTION_TOTAL} - ${phByCode[code] || 0} placeholders).`);
        }
        profile[code] = row;
    }
    return { profile, errors };
}

export function buildPlaceholderTemplates(cfg) {
    const out = [];
    for (let i = 1; i <= cfg.reasoning_img_placeholder_count; i++) {
        out.push({ section_code: 'REASONING', placeholder_id: `PLACEHOLDER_REAS_IMG_${i}` });
    }
    return out;
}

// Re-export passthroughs so the caller can pull a uniform shape from any spec.
export {
    ALLOWED_SOURCE_TYPES,
    RC_MIN_PASSAGE_CHARS_DEFAULT,
    RC_MAX_PASSAGE_CHARS_DEFAULT,
    CLOZE_MIN_PASSAGE_CHARS_DEFAULT,
    CLOZE_MAX_PASSAGE_CHARS_DEFAULT,
    CA_SUBTYPES,
    CA_FRESHNESS_QUARTERS_DEFAULT,
    ALLOWED_DIFFICULTIES,
    DIFFICULTY_LEVELS,
};
