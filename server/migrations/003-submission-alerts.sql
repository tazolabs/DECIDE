-- Add without a default first: historical jobs must not generate new alerts.
ALTER TABLE decide_jobs ADD COLUMN IF NOT EXISTS slack_alert_status text
  CHECK (slack_alert_status IN ('pending','sent','failed'));
ALTER TABLE decide_jobs ALTER COLUMN slack_alert_status SET DEFAULT 'pending';
ALTER TABLE decide_jobs ADD COLUMN IF NOT EXISTS slack_alert_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE decide_jobs ADD COLUMN IF NOT EXISTS slack_alert_lease_token uuid;
ALTER TABLE decide_jobs ADD COLUMN IF NOT EXISTS slack_alert_lease_until timestamptz;
ALTER TABLE decide_jobs ADD COLUMN IF NOT EXISTS slack_alert_next_attempt_at timestamptz;
ALTER TABLE decide_jobs ADD COLUMN IF NOT EXISTS slack_alert_sent_at timestamptz;
ALTER TABLE decide_jobs ADD COLUMN IF NOT EXISTS slack_alert_error text;
CREATE INDEX IF NOT EXISTS decide_jobs_pending_slack_idx
  ON decide_jobs(slack_alert_next_attempt_at) WHERE slack_alert_status='pending';
