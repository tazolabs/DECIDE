CREATE TABLE IF NOT EXISTS decide_invitations (
  token_hash text PRIMARY KEY,
  label text NOT NULL,
  endpoint text NOT NULL,
  max_runs integer NOT NULL CHECK (max_runs BETWEEN 1 AND 10),
  used_runs integer NOT NULL DEFAULT 0,
  max_questions integer CHECK (max_questions BETWEEN 1 AND 4867),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decide_jobs (
  id uuid PRIMARY KEY,
  invitation_hash text NOT NULL REFERENCES decide_invitations(token_hash),
  idempotency_key text NOT NULL,
  submission_hash text NOT NULL,
  model text NOT NULL,
  endpoint text NOT NULL,
  modality text NOT NULL CHECK (modality IN ('audio','text')),
  mode text NOT NULL CHECK (mode IN ('benchmark','preview')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  api_key_ciphertext text,
  total integer NOT NULL,
  cursor integer NOT NULL DEFAULT 0,
  metrics jsonb NOT NULL,
  report jsonb,
  row_attempts integer NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  not_before timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(invitation_hash,idempotency_key)
);

CREATE INDEX IF NOT EXISTS decide_jobs_active_idx ON decide_jobs(status,updated_at);

CREATE OR REPLACE FUNCTION decide_create_job(
  p_id uuid, p_invite text, p_idempotency text, p_hash text,
  p_model text, p_endpoint text, p_modality text, p_mode text,
  p_secret text, p_total integer, p_metrics jsonb
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  invitation decide_invitations%ROWTYPE;
  existing decide_jobs%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('decide-job-submission'));
  SELECT * INTO invitation FROM decide_invitations WHERE token_hash=p_invite FOR UPDATE;
  IF NOT FOUND OR invitation.expires_at<=now() OR invitation.endpoint<>p_endpoint THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;
  SELECT * INTO existing FROM decide_jobs WHERE invitation_hash=p_invite AND idempotency_key=p_idempotency;
  IF FOUND THEN
    IF existing.submission_hash<>p_hash THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    RETURN existing.id;
  END IF;
  IF invitation.used_runs>=invitation.max_runs THEN RAISE EXCEPTION 'invitation_quota_exhausted'; END IF;
  IF (SELECT count(*) FROM decide_jobs WHERE status IN ('queued','running'))>=4 THEN
    RAISE EXCEPTION 'evaluation_capacity_reached';
  END IF;
  UPDATE decide_invitations SET used_runs=used_runs+1 WHERE token_hash=p_invite;
  INSERT INTO decide_jobs(id,invitation_hash,idempotency_key,submission_hash,model,endpoint,modality,mode,
    api_key_ciphertext,total,metrics)
    VALUES(p_id,p_invite,p_idempotency,p_hash,p_model,p_endpoint,p_modality,p_mode,p_secret,p_total,p_metrics);
  RETURN p_id;
END;
$$;
