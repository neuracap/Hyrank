-- transcript_latin — romanized (Latin-script) Hinglish version of the transcript.
-- NotebookLM burns captions into videos and cannot render Devanagari, so the
-- video source uses this transliterated copy; the Devanagari `transcript` stays
-- canonical (better for ElevenLabs TTS + reviewer readability).
-- Idempotent; already applied directly on 2026-07-06.

ALTER TABLE video_script ADD COLUMN IF NOT EXISTS transcript_latin TEXT;
