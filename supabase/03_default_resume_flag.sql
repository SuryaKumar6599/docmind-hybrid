-- DocMind Hybrid: Phase 3 — default resume flag
-- Run this in your Supabase SQL Editor to apply updates.

-- ============================================================
-- 1. Add is_default to resumes
-- ============================================================

ALTER TABLE resumes
ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Only one resume per user can be the default at a time.
CREATE UNIQUE INDEX IF NOT EXISTS resumes_one_default_per_user
ON resumes (user_id)
WHERE is_default;
