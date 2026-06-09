-- ============================================================
-- 2026-06-09 — Rename existing TOPIC tests to "{subtype} {letter}{N}"
-- ============================================================
-- Old names like "Topic 1" / "Topic B57" leave the subtype out. This
-- script relabels every TOPIC test to "{subtype} A1" / "{subtype} B1" /
-- "{subtype} C1" with N counting per (subtype, difficulty_level) in
-- created_at order — so the first GK-Misc Level-B test becomes
-- "GK Misc B1", the second "GK Misc B2", and Profit&Loss's first L-B
-- test also gets "Profit & Loss B1" (independent counter).
--
-- Idempotent on tests already renamed (their names won't match the
-- "^Topic ..." regex any more, so they'll be skipped).
-- ============================================================

BEGIN;

WITH topic_info AS (
    SELECT mt.mock_test_id, mt.difficulty_level, mt.created_at,
           COALESCE(
               mt.stats_json->'topic'->>'subtype',
               mb.config_json->'generated_from'->>'subtype'
           ) AS subtype
    FROM mock_test mt
    LEFT JOIN mock_blueprint mb ON mb.blueprint_id = mt.blueprint_id
    WHERE mt.test_type = 'TOPIC'
      AND mt.name ~ '^Topic [A-Z]?\d+$'
      AND mt.difficulty_level IS NOT NULL
),
ranked AS (
    SELECT mock_test_id, subtype, difficulty_level,
           ROW_NUMBER() OVER (
               PARTITION BY subtype, difficulty_level
               ORDER BY created_at
           ) AS rn
    FROM topic_info
    WHERE subtype IS NOT NULL AND subtype != ''
)
UPDATE mock_test mt
SET name = INITCAP(REPLACE(r.subtype, '_', ' ')) || ' ' ||
           CASE r.difficulty_level
               WHEN 1 THEN 'A'
               WHEN 2 THEN 'B'
               WHEN 3 THEN 'C'
           END ||
           r.rn,
    updated_at = NOW()
FROM ranked r
WHERE mt.mock_test_id = r.mock_test_id;

-- Optional cleanup: short 2-letter words inside the renamed labels should
-- typically be acronyms (GK, GA, GS). INITCAP turns "gk_misc" into
-- "Gk Misc" — admin can inline-rename specific names if a different
-- casing is desired (e.g., "GK Misc" instead of "Gk Misc").

-- Sanity report — should show 0 unrenamed rows
SELECT COUNT(*) AS unrenamed_topic_tests
FROM mock_test
WHERE test_type = 'TOPIC'
  AND name ~ '^Topic [A-Z]?\d+$';

COMMIT;
