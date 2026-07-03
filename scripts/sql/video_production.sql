-- video_production — extends video_script with the post-approval production pipeline.
-- Additive migration: run AFTER video_script.sql, on Supabase (SQL editor).
--
-- Lifecycle (prod_stage):
--   NONE       script not yet approved (not on the production board)
--   QUEUED     script approved, ready to start production
--   VIDEO      NotebookLM video being generated (manual; paste video_url when done)
--   EDIT       assets gathered, combining/editing (CapCut/Canva/InShot; paste final_url)
--   READY      final video rendered, awaiting publication
--   PUBLISHED  live (publish_url + platform + published_at recorded)
--
-- Audio (ElevenLabs, optional per video) is tracked as an asset alongside the stage,
-- not as its own stage — needs_audio + audio_url + audio_status.

ALTER TABLE video_script
    ADD COLUMN IF NOT EXISTS prod_stage       TEXT NOT NULL DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS needs_audio       BOOLEAN NOT NULL DEFAULT true,   -- ElevenLabs step wanted? ("not always")
    ADD COLUMN IF NOT EXISTS video_url         TEXT,        -- NotebookLM output (link or hosted)
    ADD COLUMN IF NOT EXISTS audio_url         TEXT,        -- ElevenLabs / manual audio (hosted MP3 or link)
    ADD COLUMN IF NOT EXISTS audio_status      TEXT,        -- NULL | GENERATING | DONE | FAILED
    ADD COLUMN IF NOT EXISTS audio_error       TEXT,
    ADD COLUMN IF NOT EXISTS audio_voice       TEXT,        -- which ELEVEN_VOICES label was used

    ADD COLUMN IF NOT EXISTS final_url         TEXT,        -- combined/edited video (link or hosted)
    ADD COLUMN IF NOT EXISTS publish_url        TEXT,
    ADD COLUMN IF NOT EXISTS publish_platform   TEXT,        -- e.g. Instagram, YouTube Shorts
    ADD COLUMN IF NOT EXISTS published_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS prod_notes         TEXT,
    ADD COLUMN IF NOT EXISTS prod_updated_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS prod_updated_by    INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS video_script_prod_stage_idx ON video_script (prod_stage);

-- Backfill: any already-approved scripts should enter the board as QUEUED.
UPDATE video_script SET prod_stage = 'QUEUED'
    WHERE status = 'APPROVED' AND prod_stage = 'NONE';
