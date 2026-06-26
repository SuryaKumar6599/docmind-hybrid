-- DocMind Hybrid: Phase 1 v2 — shared application state
-- Run this in your Supabase SQL Editor to apply updates.
--
-- Scope, per the architecture review: job_applications already has
-- match_score, stage1_analysis, stage2_content, docx_url, pdf_url — those
-- are NOT recreated here. The only genuinely new columns are jd_content
-- and resumes.parent_resume_id.

-- ============================================================
-- 1. Persist pasted/extracted JD text directly on the application
-- ============================================================

ALTER TABLE job_applications
ADD COLUMN IF NOT EXISTS jd_content text;

-- ============================================================
-- 2. Resume lineage (base → tailored), Phase 1 scope only
-- ============================================================
-- ON DELETE RESTRICT: deleting a base resume that has tailored children
-- fails loudly instead of silently orphaning them. The app should catch
-- this and tell the user to deal with the children first.

ALTER TABLE resumes
ADD COLUMN IF NOT EXISTS parent_resume_id uuid REFERENCES resumes(id) ON DELETE RESTRICT;
