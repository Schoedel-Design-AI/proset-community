-- Phase 1: support combining multiple recordings into a single conversion output.
-- Adds a JSONB array column to user_files to track all source recordings for
-- combined conversions. The existing scalar `source_recording_id` column is
-- retained for backwards compatibility and for single-source conversions.

ALTER TABLE user_files
  ADD COLUMN IF NOT EXISTS source_recording_ids jsonb;
