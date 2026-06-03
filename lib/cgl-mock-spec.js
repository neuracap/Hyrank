/**
 * SSC CGL Tier 1 mock-test spec, expressed as data.
 * Used by the picker and the API; UI reads names from here too.
 */

// The exam we are building mocks for (writes go here).
export const CGL_T1_EXAM_ID = 'dab3d0fd-7a06-4bae-a9ac-0f14f2d57157';

// Target section IDs on SSC CGL Tier 1 (used for mock_test_question.exam_section_id).
export const TARGET_SECTION_IDS = {
    REASONING: '28c47413-d24d-4a7e-a009-8dadf1a7b4e8',
    GA:        '5fd97800-8388-419b-adf8-b2edac3a248f',
    QUANT:     '817fb23e-3856-411e-8c56-93d0eed9b169',
    ENGLISH:   'd035e044-de36-45da-9cd5-07ebf557866d',
};

// Source section IDs on the bank (used to query the pool).
export const BANK_SECTION_IDS = {
    REASONING: '03137dd2-302c-48fb-8bff-6cc1c7543500',
    GA:        '1838f918-a330-492d-a245-a0075471db9c',
    QUANT:     'e655c811-3b92-4c56-9e9d-b6b3c4d10174',
    ENGLISH:   'c713a37b-15f0-4608-aac5-eba9cf490ff8',
};

export const SECTION_CODES = ['REASONING', 'GA', 'QUANT', 'ENGLISH'];

export const SECTION_TOTAL = 25;
export const MOCK_TOTAL = 100;

/**
 * Minimum passage length (in chars of passage_en) for an RC group to qualify
 * for a CGL T1 mock. ~1400 chars ≈ 200 words; SSC CHSL / GD spec files will
 * carry lower numbers. Users can override per-mock via config.rc_min_passage_chars.
 */
export const RC_MIN_PASSAGE_CHARS_DEFAULT = 1400;

/**
 * Per-section subtype weightages. Each "spec_subtype" is matched against the
 * bank's qv.subtype with prefix matching (qv.subtype LIKE 'analogy\\_%').
 *
 * Group slots are declared separately on each section under `groups`.
 * Remainder rules describe how to absorb leftover slots when fixed targets
 * don't sum to (25 - placeholders - group_size).
 */
export const SECTION_SPEC = {
    REASONING: {
        targets: {
            analogy: 3,
            odd_one_out: 3,            // "classification/odd-one-out"
            series: 3,
            coding_decoding: 3,
            blood_relation: 2,
            direction_sense: 1,
            word_arrangement: 2,        // "ranking/word_arrangement"
            syllogism: 2,
            venn_diagram: 2,
            mathematical_operation: 2,
            missing_number: 2,
        },
        remainder_subtypes: ['cube_dice', 'arithmetic_reasoning'],
        groups: [],
    },
    GA: {
        targets: {
            history: 3,
            polity: 3,
            geography: 3,
            economics: 2,
            science_ga: 8,             // bank uses science_ga_* prefix
            static_gk: 2,
        },
        remainder_subtypes: ['science_ga', 'static_gk'], // also where CA shortfall goes
        groups: [],
    },
    QUANT: {
        targets: {
            arithmetic: 12,            // mid-band: 12 (~12-15)
            advanced: 8,
            number_system: 2,
        },
        // QUANT DI is conditional: include one DI group (~3 questions) if config.include_quant_di
        groups: [
            { group_type: 'DI', count_if_true: 1, expected_size_min: 3, expected_size_max: 5 },
        ],
        // When DI is NOT included, those slots redistribute to arithmetic.
        remainder_subtypes: ['arithmetic'],
    },
    ENGLISH: {
        targets: {
            vocabulary: 8,
            grammar: 8,
            comprehension: 0,           // filled by RC/Cloze groups + parajumble in remainder
        },
        groups: [
            { group_type: 'RC',    count_if_true: 1, expected_size_min: 5, expected_size_max: 5, when_config: 'include_english_rc' },
            { group_type: 'CLOZE', count_if_true: 1, expected_size_min: 5, expected_size_max: 5, when_config: 'include_english_cloze' },
        ],
        remainder_subtypes: ['comprehension', 'parajumble'],
    },
};

/**
 * Maps a "spec_subtype" to bank-subtype prefix patterns. The picker turns these
 * into SQL like `qv.subtype LIKE ANY ARRAY['analogy\\_%','analogy_%_analogy']`.
 *
 * Order in the array doesn't matter — a row matches the prefix if ANY pattern
 * succeeds. Keep these conservative; broader matches go into remainder.
 */
export const SUBTYPE_PREFIXES = {
    // REASONING
    analogy:               ['analogy_%'],
    odd_one_out:           ['odd_one_out_%'],
    series:                ['series_%'],
    coding_decoding:       ['coding_decoding_%'],
    blood_relation:        ['blood_relation_%'],
    direction_sense:       ['direction_sense_%', 'direction_%'],
    word_arrangement:      ['word_arrangement_%', 'sitting_arrangement_%'],
    syllogism:             ['syllogism_%'],
    venn_diagram:          ['venn_diagram_%'],
    mathematical_operation:['mathematical_operation_%'],
    missing_number:        ['missing_number_%'],
    cube_dice:             ['cube_dice_%'],
    arithmetic_reasoning:  ['arithmetic_reasoning_%'],
    // GA
    history:    ['history_%'],
    polity:     ['polity_%'],
    geography:  ['geography_%'],
    economics:  ['economics_%'],
    science_ga: ['science_ga_%', 'science_%'],
    static_gk:  ['static_gk_%', 'static_%_gk_%', 'culture_%', 'sports_%', 'awards_%', 'misc_static_%'],
    // QUANT
    arithmetic:    ['arithmetic_%', 'percentage_%', 'profit_loss_%', 'time_and_work_%', 'ratio_%', 'average_%', 'simple_interest_%', 'compound_interest_%', 'speed_%', 'mixture_%', 'partnership_%'],
    advanced:      ['algebra_%', 'geometry_%', 'trigonometry_%', 'mensuration_%', 'coordinate_%'],
    number_system: ['number_system_%', 'number_%'],
    // ENGLISH
    vocabulary:    ['synonyms_%', 'antonyms_%', 'one_word_substitution_%', 'ows_%', 'idioms_%', 'spelling_check_%', 'homonyms_%'],
    grammar:       ['active_passive_%', 'narration_%', 'sentence_improvement_%', 'spot_the_error_%', 'fill_in_the_blanks_%', 'tense_%', 'preposition_%', 'article_%'],
    comprehension: ['comprehension_%'],
    parajumble:    ['parajumble_%', 'para_jumble_%'],
};

/**
 * Allowed difficulty levels in the pool. Was [2, 3]; widened to [1, 2, 3, 4]
 * so per-mock difficulty profiles can use the full bank.
 */
export const ALLOWED_DIFFICULTIES = [1, 2, 3, 4];
export const DIFFICULTY_LEVELS = [1, 2, 3, 4];

/**
 * CGL T1 base difficulty profile per section. Each row sums to SECTION_TOTAL (25).
 * The picker subtracts placeholder counts before treating these as targets, so
 * the *drawn* questions per level become (base - placeholders absorbed from that level).
 * Step 1 of the builder seeds its grid from here; the user can override per mock.
 */
export const SECTION_DIFFICULTY_BASE = {
    REASONING: { L1: 0, L2: 12, L3: 13, L4: 0 },
    GA:        { L1: 0, L2: 12, L3: 13, L4: 0 },
    QUANT:     { L1: 0, L2: 11, L3: 14, L4: 0 },
    ENGLISH:   { L1: 0, L2: 8,  L3: 15, L4: 2 },
};

/**
 * Validates and normalizes a MOCK CONFIGURATION input.
 */
export function normalizeConfig(input) {
    const cfg = {
        include_english_rc:                Boolean(input?.include_english_rc),
        include_english_cloze:             Boolean(input?.include_english_cloze),
        include_quant_di:                  Boolean(input?.include_quant_di),
        reasoning_img_placeholder_count:   Math.max(0, Math.min(10, parseInt(input?.reasoning_img_placeholder_count ?? 0, 10) || 0)),
        ga_ca_placeholder_count:           Math.max(0, Math.min(10, parseInt(input?.ga_ca_placeholder_count ?? 0, 10) || 0)),
        rc_min_passage_chars:              Math.max(0, Math.min(5000, parseInt(input?.rc_min_passage_chars ?? RC_MIN_PASSAGE_CHARS_DEFAULT, 10) || 0)),
    };
    return cfg;
}

/**
 * Placeholder counts per section, derived from config.
 * QUANT and ENGLISH never carry placeholders today.
 */
export function placeholderCountsBySection(cfg) {
    return {
        REASONING: cfg.reasoning_img_placeholder_count,
        GA:        cfg.ga_ca_placeholder_count,
        QUANT:     0,
        ENGLISH:   0,
    };
}

/**
 * Validates and normalizes a DIFFICULTY PROFILE input.
 *
 * Input shape: { REASONING: {L1,L2,L3,L4}, GA: {...}, QUANT: {...}, ENGLISH: {...} }
 *
 * Falls back to SECTION_DIFFICULTY_BASE per missing section/level.
 * Each section's sum must equal (SECTION_TOTAL - placeholderCount[section]).
 * Returns { profile, errors } — caller checks errors.length === 0.
 */
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

/**
 * Returns the placeholder list for a config, for inclusion in stats_json.
 * Positions are filled in later by the picker.
 */
export function buildPlaceholderTemplates(cfg) {
    const out = [];
    for (let i = 1; i <= cfg.reasoning_img_placeholder_count; i++) {
        out.push({ section_code: 'REASONING', placeholder_id: `PLACEHOLDER_REAS_IMG_${i}` });
    }
    for (let i = 1; i <= cfg.ga_ca_placeholder_count; i++) {
        out.push({ section_code: 'GA', placeholder_id: `PLACEHOLDER_GA_CA_${i}` });
    }
    return out;
}
