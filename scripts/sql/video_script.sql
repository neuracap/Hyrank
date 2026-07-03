-- video_script — voiceover transcripts for the vocab Reels/Shorts pipeline.
-- One row per English word from docs/words.csv. Gemini generates `raw_transcript`;
-- an admin reviewer edits `transcript` and approves before a video is produced.
--
-- Run this on Supabase (SQL editor) before running scripts/generate_video_scripts.js.

CREATE TABLE IF NOT EXISTS video_script (
    video_script_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    word            TEXT NOT NULL,
    word_sno        INTEGER,                              -- Sno column from words.csv
    raw_transcript  TEXT,                                 -- exact Gemini output, kept immutable for reference
    transcript      TEXT,                                 -- reviewer-editable working copy (seeded from raw_transcript)
    model           TEXT,                                 -- Gemini model id used to generate
    status          TEXT NOT NULL DEFAULT 'GENERATED',    -- GENERATED | EDITED | APPROVED | FAILED
    gen_error       TEXT,                                 -- populated when status = 'FAILED'
    reviewed_by     INTEGER REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One transcript per word (case-insensitive). Lets the generator upsert / skip existing.
CREATE UNIQUE INDEX IF NOT EXISTS video_script_word_uniq ON video_script (lower(word));
CREATE INDEX IF NOT EXISTS video_script_status_idx ON video_script (status);
