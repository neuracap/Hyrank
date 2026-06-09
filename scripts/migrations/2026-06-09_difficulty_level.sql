-- ============================================================
-- 2026-06-09 — difficulty_level for shared TOPIC/SECTION tests
-- ============================================================
-- Adds:
--   mock_test.difficulty_level         (NULL | 1 | 2 | 3)  — set for TOPIC/SECTION
--   question_usage.difficulty_level    (NULL | 1 | 2 | 3)  — set for TOPIC/SECTION usage rows
--   exam.difficulty_profile JSONB      ({ "primary": L, "secondary": L })
--
-- Backfills all existing TOPIC + SECTION tests + their question_usage rows
-- to level 1 (their 40/50/10 mix matches the new Level 1 definition).
-- Seeds exam profiles for the five exams currently in the DB.
--
-- Run on Supabase SQL editor.
-- ============================================================

BEGIN;

-- 1. mock_test.difficulty_level
ALTER TABLE mock_test
    ADD COLUMN IF NOT EXISTS difficulty_level INT;

ALTER TABLE mock_test
    DROP CONSTRAINT IF EXISTS mock_test_difficulty_level_check;
ALTER TABLE mock_test
    ADD CONSTRAINT mock_test_difficulty_level_check
    CHECK (difficulty_level IS NULL OR difficulty_level IN (1, 2, 3));

-- 2. question_usage.difficulty_level
ALTER TABLE question_usage
    ADD COLUMN IF NOT EXISTS difficulty_level INT;

ALTER TABLE question_usage
    DROP CONSTRAINT IF EXISTS question_usage_difficulty_level_check;
ALTER TABLE question_usage
    ADD CONSTRAINT question_usage_difficulty_level_check
    CHECK (difficulty_level IS NULL OR difficulty_level IN (1, 2, 3));

-- 3. exam.difficulty_profile
ALTER TABLE exam
    ADD COLUMN IF NOT EXISTS difficulty_profile JSONB;

-- 4. Indexes for the new exclusion + listing paths
CREATE INDEX IF NOT EXISTS idx_mock_test_type_level_status
    ON mock_test (test_type, difficulty_level, status)
    WHERE test_type IN ('TOPIC', 'SECTION');

CREATE INDEX IF NOT EXISTS idx_question_usage_type_level
    ON question_usage (test_type, difficulty_level)
    WHERE test_type IN ('TOPIC', 'SECTION');

-- 5. Backfill — existing TOPIC + SECTION tests carry the 40/50/10 mix => Level 1
UPDATE mock_test
SET difficulty_level = 1
WHERE test_type IN ('TOPIC', 'SECTION')
  AND difficulty_level IS NULL;

UPDATE question_usage
SET difficulty_level = 1
WHERE test_type IN ('TOPIC', 'SECTION')
  AND difficulty_level IS NULL;

-- 6. Seed exam profiles
--    Per user spec:
--      GD : primary L1, secondary L2
--      CGL: primary L2, secondary L3
--      CHSL: primary L3, secondary L2
--      CPO Tier 1 / Tier 2: primary L3, secondary L2 (hardest of the SSC roster)
UPDATE exam SET difficulty_profile = '{"primary": 1, "secondary": 2}'::jsonb
    WHERE name = 'SSC GD Constable';
UPDATE exam SET difficulty_profile = '{"primary": 2, "secondary": 3}'::jsonb
    WHERE name = 'SSC CGL Tier 1';
UPDATE exam SET difficulty_profile = '{"primary": 3, "secondary": 2}'::jsonb
    WHERE name IN ('SSC CHSL Tier 1', 'SSC CPO Tier 1', 'SSC CPO Tier 2');

-- 7. Anything still without a profile gets a safe default (L2 primary + secondary)
UPDATE exam SET difficulty_profile = '{"primary": 2, "secondary": 2}'::jsonb
    WHERE difficulty_profile IS NULL;

COMMIT;
