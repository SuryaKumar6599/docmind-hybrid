-- DocMind Hybrid: status transition dates for analytics
-- Stores the first/most recent date each application entered a status.

ALTER TABLE job_applications
ADD COLUMN IF NOT EXISTS status_dates jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS job_apps_status_dates_gin_idx
ON job_applications USING gin (status_dates);

-- Backfill current status for existing rows that have no date recorded yet.
UPDATE job_applications
SET status_dates = jsonb_set(
  COALESCE(status_dates, '{}'::jsonb),
  ARRAY[status],
  to_jsonb(COALESCE(application_date, created_at::date, CURRENT_DATE)::text),
  true
)
WHERE status IS NOT NULL
  AND NOT (COALESCE(status_dates, '{}'::jsonb) ? status);
