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
 * Section-wide target for PYQ-sourced picks (= 40% of SECTION_TOTAL).
 * The picker actively prefers PYQ over bank within each topic until this many
 * PYQ picks have landed; once the target is met, it switches to bank-preferred
 * for the remainder of the section. Topic round-robin still happens first —
 * source preference only resolves the within-topic candidate order.
 *
 * The cap equals the target so a section never carries MORE than 10 PYQs.
 * If a topic only has one source available, the picker takes it regardless.
 */
export const PYQ_TARGET_PER_SECTION = Math.floor(SECTION_TOTAL * 0.4);  // 10
export const PYQ_CAP_PER_SECTION = PYQ_TARGET_PER_SECTION;              // 10
export const ALLOWED_SOURCE_TYPES = ['bank', 'pyq'];

/**
 * Minimum passage length (in chars of passage_en) for an RC group to qualify
 * for a CGL T1 mock. ~1400 chars ≈ 200 words; SSC CHSL / GD spec files will
 * carry lower numbers. Users can override per-mock via config.rc_min_passage_chars.
 */
export const RC_MIN_PASSAGE_CHARS_DEFAULT = 1400;

/**
 * Maximum passage length (in chars of passage_en) for an RC group. ~1200 chars
 * ≈ 200 words. RC passages can vary 600–1500+ chars; reviewers often want a
 * tighter cap for CGL T1 (real CGL RCs are ~150–200 words). Override via
 * config.rc_max_passage_chars.
 */
export const RC_MAX_PASSAGE_CHARS_DEFAULT = 1200;

/**
 * Same idea for CLOZE — cloze passages are shorter than RCs but a 200-char
 * stub doesn't give a real exam feel. 700 chars ≈ 100 words is a sane floor
 * for CGL. Override via config.cloze_min_passage_chars.
 */
export const CLOZE_MIN_PASSAGE_CHARS_DEFAULT = 700;

/**
 * Maximum CLOZE passage length. ~750 chars ≈ 120 words is a sane ceiling for
 * a 5-blank cloze on Tier 1. Override via config.cloze_max_passage_chars.
 */
export const CLOZE_MAX_PASSAGE_CHARS_DEFAULT = 900;

/**
 * Current-affairs fine-grained buckets (controlled vocabulary).
 * Reviewer assigns one of these to each CA before approval.
 * All start with `ca_` so SUBTYPE_PREFIXES.current_affairs = ['ca_%'] catches them.
 */
export const CA_SUBTYPES = [
    'ca_economy',          // budget, RBI, banking, GDP, inflation, schemes-with-economic-angle
    'ca_polity_schemes',   // govt schemes, appointments to constitutional posts, bills, policy
    'ca_awards_sports',    // Padma awards, Oscars, sports honours, championships
    'ca_international',    // foreign affairs, summits, treaties, bilaterals
    'ca_science_tech',     // ISRO, defence tech, medical, telecom
    'ca_misc',             // books, obituaries, indices, anniversaries — catch-all
];

/**
 * How many quarters back from "now" a CA question stays eligible for new mocks.
 * 4 quarters ≈ 1 year. Per-mock override via config.ca_freshness_quarters.
 */
export const CA_FRESHNESS_QUARTERS_DEFAULT = 4;

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
        // static_gk dropped (bank has zero static_gk_*/culture/sports/awards tagged Qs);
        // 2 freed slots redistributed proportionally → +1 science_ga, +1 current_affairs.
        targets: {
            history: 3,
            polity: 3,
            geography: 3,
            economics: 2,
            science_ga: 9,             // was 8; +1 from static_gk redistribute
            current_affairs: 5,        // was 4; +1 from static_gk redistribute
        },
        remainder_subtypes: ['science_ga', 'current_affairs'],
        groups: [],
    },
    QUANT: {
        // 4-bucket split: arithmetic (interest/profit-loss/ratio/avg/partnership/discount/percentage/mixture),
        // applied (speed-distance variants, work-time, pipes, statistics, probability, simplification, DI standalone),
        // number_system (lcm-hcf, remainders, divisibility, digit/unit, other), advanced (algebra/geom/mens/trig/coord).
        targets: {
            arithmetic:    8,
            applied:       7,
            number_system: 3,
            advanced:      7,
        },
        // When include_quant_di toggles DI group on, group slots come OUT OF the applied bucket
        // (so applied shrinks 7 → 7 − group_size).
        di_absorbs_from: 'applied',
        groups: [
            { group_type: 'DI', count_if_true: 1, expected_size_min: 3, expected_size_max: 5,
              // Bank has only 8 DI groups — exhausts fast across mocks. When pickGroup fails,
              // backfill from standalone data_interpretation_* questions so the section still
              // carries DI-flavored items instead of redistributing all 5 slots to non-DI.
              fallback_subtype_prefix: 'data_interpretation_' },
        ],
        remainder_subtypes: ['applied', 'arithmetic'],
    },
    ENGLISH: {
        // parajumble promoted from remainder to explicit target (always 2).
        // vocabulary / grammar share whatever's left after groups + parajumble, ~9/9 with RC only.
        targets: {
            parajumble: 2,
            vocabulary: 9,
            grammar:    9,
        },
        // Never trim parajumble during overflow handling (sacred minimum).
        protected_targets: ['parajumble'],
        groups: [
            { group_type: 'RC',    count_if_true: 1, expected_size_min: 5, expected_size_max: 5,
              when_config: 'include_english_rc',
              // For CGL T1: prefer RC groups whose member difficulty mix is closest to 3 L2 + 2 L3.
              // Soft preference (only 1 RC group in the bank literally matches), composition score
              // outranks passage length; passage length is the tiebreak.
              prefer_composition: { L1: 0, L2: 3, L3: 2, L4: 0 } },
            { group_type: 'CLOZE', count_if_true: 1, expected_size_min: 5, expected_size_max: 5,
              when_config: 'include_english_cloze' },
        ],
        remainder_subtypes: ['vocabulary', 'grammar'],
    },
};

/**
 * BUCKET_TOPICS: per-bucket TOPIC LAYER between spec_subtype and bank_subtype.
 *
 * For each spec_subtype here, the picker switches from "pick variation-diverse from
 * the whole bag" to "round-robin across topics, max MAX_PER_TOPIC per topic, capped
 * at the bucket target". This is the core fix for clustering inside a bucket — e.g.
 * 5 percentage questions inside an "arithmetic" slot of 8 — because bank subtypes
 * are `topic_subtopic_focus` strings so variation diversity alone clusters by topic.
 *
 * Prefixes are tried in declaration order; first match wins, so a bank subtype maps
 * to exactly ONE topic. Subtypes that match no prefix fall into '_other' and are
 * drained only after every named topic has its MAX_PER_TOPIC quota.
 *
 * Clean partition (no overlaps):
 *   - speed-distance variants (tsd, linear_circular, boat_stream, height_distance) live ONLY in `applied`
 *   - discount lives ONLY in `arithmetic`
 *   - hcf_lcm lives ONLY in `number_system`
 */
export const BUCKET_TOPICS = {
    // QUANT — arithmetic bucket (8 slots, max 2 per topic). User-listed topics:
    // interest, profit-loss, ratio-proportion, averages, partnership, percentage,
    // mixture. (Discount moved to `applied` per user spec.)
    arithmetic: {
        percentage:         ['percentage_'],
        profit_loss:        ['profit_loss_'],
        simple_interest:    ['simple_interest_'],
        compound_interest:  ['compound_interest_'],
        ratio_proportion:   ['ratio_proportion_'],
        average:            ['average_'],
        partnership:        ['partnership_'],
        mixture_alligation: ['mixture_', 'alligation_'],
    },
    // QUANT — applied bucket (7 slots, max 2 per topic). User-listed "other" topics:
    // DI, speed-distance, pipes, statistics, probability, simplification, work-time,
    // discounts. DI standalone questions (subtype data_interpretation_*) belong here
    // too, in case include_quant_di is OFF and standalone DI rows exist in the pool.
    applied: {
        time_speed_distance: ['tsd_', 'time_speed_distance_', 'speed_'],
        tracks_races:        ['linear_circular_'],
        boat_stream:         ['boat_stream_'],
        work_time:           ['work_time_', 'time_and_work_', 'time_work_'],
        pipes_cistern:       ['pipe_cistern_', 'pipes_cistern_', 'pipe_'],
        simplification:      ['simplification_'],
        statistics:          ['mean_median_mode_'],
        probability:         ['probability_'],
        height_distance:     ['height_distance_'],
        discount:            ['discount_'],
        data_interpretation: ['data_interpretation_'],
    },
    // QUANT — number_system bucket (3 slots, max 1 per topic so 3 distinct topics)
    number_system: {
        hcf_lcm:       ['hcf_lcm_'],
        remainders:    ['number_system_remainders_'],
        divisibility: ['number_system_divisibility_', 'number_system_greatest_least_'],
        digit_unit:    ['number_system_digit_', 'number_system_perfect_', 'number_system_consecutive_', 'number_system_counting_'],
        number_other:  ['number_system_', 'number_'],   // catch-all for whatever's left
    },
    // QUANT — advanced bucket (7 slots, max 2 per topic across 5 topics)
    advanced: {
        algebra:             ['algebra_'],
        geometry:            ['geometry_'],
        mensuration:         ['mensuration_'],
        trigonometry:        ['trigonometry_'],
        coordinate_geometry: ['coordinate_geometry_', 'coordinate_'],
    },
    // ENGLISH — vocabulary bucket (max 2 per topic across 6 topics)
    vocabulary: {
        synonyms:              ['synonyms_'],
        antonyms:              ['antonyms_'],
        homonyms:              ['homonyms_'],
        idioms:                ['idioms_'],
        spelling:              ['spelling_check_', 'spelling_'],
        one_word_substitution: ['one_word_substitution_', 'ows_'],
    },
    // ENGLISH — grammar bucket (max 2 per topic across 5 topics)
    grammar: {
        fill_in_the_blanks:   ['fill_in_the_blanks_'],
        narration:            ['narration_'],
        sentence_improvement: ['sentence_improvement_'],
        active_passive:       ['active_passive_'],
        spot_the_error:       ['spot_the_error_'],
    },
    // GA — science_ga bucket (9 slots, max 4 per sub-area so 3 sub-areas can each
    // contribute ≥2 instead of clustering on science_ga_chem_organic_everyday).
    science_ga: {
        biology:   ['science_ga_bio_'],
        chemistry: ['science_ga_chem_'],
        physics:   ['science_ga_phys', 'science_ga_physics'],
    },
    // GA — current_affairs bucket (5 slots, max 2 per CA bucket so we touch ≥3 of 6 CA buckets).
    current_affairs: {
        ca_economy:        ['ca_economy'],
        ca_polity_schemes: ['ca_polity_schemes'],
        ca_awards_sports:  ['ca_awards_sports'],
        ca_international:  ['ca_international'],
        ca_science_tech:   ['ca_science_tech'],
        ca_misc:           ['ca_misc'],
    },
};

/**
 * Per-bucket cap on how many questions can come from a single topic before
 * the picker has to drain other topics first. Defaults to 2 if a bucket is
 * declared in BUCKET_TOPICS but missing here.
 */
export const MAX_PER_TOPIC = {
    arithmetic:      2,
    applied:         2,
    number_system:   1,
    advanced:        2,
    vocabulary:      2,
    grammar:         2,
    science_ga:      4,
    current_affairs: 2,
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
    // QUANT — clean partition: each bank prefix belongs to exactly ONE bucket.
    // Speed-distance variants, work-time, pipes, statistics, probability, simplification,
    // discount, DI standalone all moved from arithmetic → applied. number_system absorbs hcf_lcm.
    arithmetic:    [
        'percentage_%',
        'profit_loss_%',
        'simple_interest_%',
        'compound_interest_%',
        'ratio_proportion_%',
        'average_%',
        'partnership_%',
        'mixture_%', 'alligation_%',
        'arithmetic_%',  // catch-all for legacy 'arithmetic_*' tags
    ],
    applied:       [
        'tsd_%', 'time_speed_distance_%', 'speed_%',
        'linear_circular_%',
        'boat_stream_%',
        'work_time_%', 'time_and_work_%', 'time_work_%',
        'pipe_cistern_%', 'pipes_cistern_%', 'pipe_%',
        'simplification_%',
        'mean_median_mode_%',
        'probability_%',
        'height_distance_%',
        'discount_%',
        'data_interpretation_%',
    ],
    advanced:      ['algebra_%', 'geometry_%', 'trigonometry_%', 'mensuration_%', 'coordinate_geometry_%', 'coordinate_%'],
    number_system: ['hcf_lcm_%', 'number_system_%', 'number_%'],
    // ENGLISH
    vocabulary:    ['synonyms_%', 'antonyms_%', 'one_word_substitution_%', 'ows_%', 'idioms_%', 'spelling_check_%', 'spelling_%', 'homonyms_%'],
    grammar:       ['active_passive_%', 'narration_%', 'sentence_improvement_%', 'spot_the_error_%', 'fill_in_the_blanks_%', 'tense_%', 'preposition_%', 'article_%'],
    comprehension: ['comprehension_%'],
    parajumble:    ['parajumble_%', 'para_jumble_%'],
    // CURRENT AFFAIRS — all CA buckets share the ca_ prefix
    current_affairs: ['ca_%'],
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
        // ga_ca_placeholder_count removed: CA is now a regular GA subtype drawn from the bank.
        // Legacy CGL T1 mocks created before this change can still carry PLACEHOLDER_GA_CA_*
        // entries in stats_json — those are handled by the backfill route.
        rc_min_passage_chars:              Math.max(0, Math.min(5000, parseInt(input?.rc_min_passage_chars ?? RC_MIN_PASSAGE_CHARS_DEFAULT, 10) || 0)),
        rc_max_passage_chars:              Math.max(100, Math.min(5000, parseInt(input?.rc_max_passage_chars ?? RC_MAX_PASSAGE_CHARS_DEFAULT, 10) || RC_MAX_PASSAGE_CHARS_DEFAULT)),
        cloze_min_passage_chars:           Math.max(0, Math.min(5000, parseInt(input?.cloze_min_passage_chars ?? CLOZE_MIN_PASSAGE_CHARS_DEFAULT, 10) || 0)),
        cloze_max_passage_chars:           Math.max(100, Math.min(5000, parseInt(input?.cloze_max_passage_chars ?? CLOZE_MAX_PASSAGE_CHARS_DEFAULT, 10) || CLOZE_MAX_PASSAGE_CHARS_DEFAULT)),
        ca_freshness_quarters:             Math.max(1, Math.min(20, parseInt(input?.ca_freshness_quarters ?? CA_FRESHNESS_QUARTERS_DEFAULT, 10) || CA_FRESHNESS_QUARTERS_DEFAULT)),
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
        GA:        0,    // CA used to live here as placeholders; now drawn from bank
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
    // GA CA placeholders removed (CA now drawn from bank as current_affairs subtype)
    return out;
}
