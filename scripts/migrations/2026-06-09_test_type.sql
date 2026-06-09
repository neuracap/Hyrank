-- ============================================================
-- 2026-06-09 — test_type tagging for mock_test and question_usage
-- ============================================================
-- Adds a test_type discriminator so a question can be consumed by
-- at most one FULL_MOCK, one TOPIC test, and one SECTION test per
-- exam (instead of being locked across all three kinds).
--
-- Run on Supabase SQL editor.
-- ============================================================

BEGIN;

-- 1. mock_test.test_type
ALTER TABLE mock_test
    ADD COLUMN IF NOT EXISTS test_type TEXT NOT NULL DEFAULT 'FULL_MOCK';

ALTER TABLE mock_test
    DROP CONSTRAINT IF EXISTS mock_test_test_type_check;
ALTER TABLE mock_test
    ADD CONSTRAINT mock_test_test_type_check
    CHECK (test_type IN ('FULL_MOCK', 'TOPIC', 'SECTION'));

-- 2. question_usage.test_type
ALTER TABLE question_usage
    ADD COLUMN IF NOT EXISTS test_type TEXT NOT NULL DEFAULT 'FULL_MOCK';

ALTER TABLE question_usage
    DROP CONSTRAINT IF EXISTS question_usage_test_type_check;
ALTER TABLE question_usage
    ADD CONSTRAINT question_usage_test_type_check
    CHECK (test_type IN ('FULL_MOCK', 'TOPIC', 'SECTION'));

-- 3. Indexes for the exclusion queries the generators run on every
--    test-creation request.
CREATE INDEX IF NOT EXISTS idx_mock_test_exam_type_status
    ON mock_test (exam_id, test_type, status);
CREATE INDEX IF NOT EXISTS idx_question_usage_exam_type
    ON question_usage (exam_id, test_type);

-- 4. Backfill: tag any existing topic tests created before the
--    migration (their blueprints follow the "Topic N" naming).
UPDATE mock_test SET test_type = 'TOPIC'
WHERE test_type = 'FULL_MOCK'
  AND blueprint_id IN (
      SELECT blueprint_id FROM mock_blueprint
      WHERE name ~ '^Topic \d+$'
  );

COMMIT;
