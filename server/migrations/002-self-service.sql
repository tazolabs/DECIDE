ALTER TABLE decide_jobs ALTER COLUMN invitation_hash DROP NOT NULL;
ALTER TABLE decide_jobs ADD COLUMN IF NOT EXISTS network_hash text;
ALTER TABLE decide_jobs ADD COLUMN IF NOT EXISTS credential_hash text;
ALTER TABLE decide_jobs ADD COLUMN IF NOT EXISTS preflight_passed boolean NOT NULL DEFAULT false;
ALTER TABLE decide_jobs ADD COLUMN IF NOT EXISTS preflight_attempts integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS decide_jobs_public_idempotency_idx
  ON decide_jobs(idempotency_key) WHERE invitation_hash IS NULL;
CREATE INDEX IF NOT EXISTS decide_jobs_public_quota_idx ON decide_jobs(created_at,mode)
  WHERE invitation_hash IS NULL;

CREATE OR REPLACE FUNCTION decide_create_public_job(
  p_id uuid, p_network text, p_credential text, p_idempotency text, p_hash text,
  p_model text, p_endpoint text, p_modality text, p_mode text,
  p_secret text, p_total integer, p_metrics jsonb, p_limits jsonb
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  existing decide_jobs%ROWTYPE;
  day_start timestamptz := date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('decide-job-submission'));
  SELECT * INTO existing FROM decide_jobs WHERE invitation_hash IS NULL AND idempotency_key=p_idempotency;
  IF FOUND THEN
    IF existing.submission_hash<>p_hash THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    RETURN existing.id;
  END IF;
  IF p_mode NOT IN ('preview','benchmark') OR p_total<>(CASE WHEN p_mode='preview' THEN 6 ELSE 4867 END) THEN
    RAISE EXCEPTION 'invalid_evaluation_configuration';
  END IF;
  IF (SELECT count(*) FROM decide_jobs WHERE invitation_hash IS NULL AND mode=p_mode
      AND created_at>=day_start AND network_hash=p_network)>=(p_limits->>('network_'||p_mode))::integer THEN
    RAISE EXCEPTION 'daily_network_run_limit';
  END IF;
  IF (SELECT count(*) FROM decide_jobs WHERE invitation_hash IS NULL AND mode=p_mode
      AND created_at>=day_start AND credential_hash=p_credential)>=(p_limits->>('credential_'||p_mode))::integer THEN
    RAISE EXCEPTION 'daily_model_api_run_limit';
  END IF;
  IF (SELECT count(*) FROM decide_jobs WHERE invitation_hash IS NULL AND mode=p_mode
      AND created_at>=day_start)>=(p_limits->>('global_'||p_mode))::integer THEN
    RAISE EXCEPTION 'daily_service_run_limit';
  END IF;
  IF (SELECT count(*) FROM decide_jobs WHERE status IN ('queued','running'))>=(p_limits->>'active')::integer THEN
    RAISE EXCEPTION 'evaluation_capacity_reached';
  END IF;
  INSERT INTO decide_jobs(id,network_hash,credential_hash,idempotency_key,submission_hash,model,endpoint,modality,mode,
    api_key_ciphertext,total,metrics)
    VALUES(p_id,p_network,p_credential,p_idempotency,p_hash,p_model,p_endpoint,p_modality,p_mode,p_secret,p_total,p_metrics);
  RETURN p_id;
END;
$$;
