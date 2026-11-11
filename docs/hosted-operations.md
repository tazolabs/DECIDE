# Hosted evaluator operations

## Architecture

`POST /api/evaluations` accepts a compatible public HTTPS model endpoint directly.
No invitation, email, account or operator approval is required. Automatic address
checks and atomic daily/concurrency quotas decide admission. The model key is
encrypted in Neon Postgres; Vercel Queues delivers only the job ID to the private
`api/consume.mjs` worker in `iad1`.

Full runs first test the API on one of the six public examples. Only after a valid
response does the worker load private data and begin scoring. It validates audio
hashes and responses, and persists aggregate counters plus a cursor. Batches
contain up to three questions; a database lease and queue redelivery support
continuation. Model keys are cleared at every terminal status.

The worker executes our evaluator code, not participant code. A separate sandbox
is unnecessary for API-only submissions. A sandbox/container submission mode
would require a separate isolated execution path, restricted networking and
controlled outputs. Calling an external model API from a sandbox would still
send inputs to that API operator. Model operators receive inference inputs;
participants do not receive dataset files, reference labels or per-row results.

## Production configuration

Project: `kodimo/decide-benchmark`. Use a current Vercel CLI (`npm i -g vercel@latest`).
Inspect the target project/team before deploying. The linked **Neon** resource
`decide-evaluation-jobs` is separate from the annotation application's database.
Queue consumers are private platform triggers, not public HTTP model endpoints.

Production-only environment variables:

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Marketplace-provisioned Neon connection string |
| `HF_TOKEN` | Fine-grained read token for private `tazolabs/DECIDE` only |
| `DECIDE_DATASET_REVISION` | Immutable 40-character Hugging Face commit |
| `DECIDE_BUNDLE_SHA256` | Expected SHA-256 of `hosted/decide-v1.json.gz` |
| `DECIDE_ENCRYPTION_KEY` | Persistent 32-byte key, encoded as 64 lowercase hex characters |
| `DECIDE_PUBLIC_ORIGIN` | `https://decide-benchmark.vercel.app` |
| `DECIDE_SLACK_WEBHOOK_URL` | Optional channel-specific Slack Incoming Webhook for new submissions |
| `CRON_SECRET` | Random secret authorizing scheduled Slack-alert recovery |

Keep these in Vercel production environment settings and a gitignored
`.env.hosted.local` for operator commands. Do not put them in public browser
variables, logs or repository files. Preserve the encryption key: changing it
invalidates old receipts and prevents decrypting active jobs. It encrypts model
keys with AES-256-GCM and derives result tokens. Model keys are cleared when jobs
complete, fail or are cancelled. Legacy invitation hashes are retained only for earlier jobs.

```bash
npm ci
npm run db:setup
```

Setup applies the base schema and idempotent SQL migrations in order. Migration
`002-self-service.sql` adds automatic admission and public-example preflight state.
Earlier jobs and their receipts continue to work; archived invitation records are
retained only for those jobs. New submissions do not use invitations.

## Automatic admission settings

Limits are enforced atomically in Postgres, including concurrent submissions.
An existing identical idempotency key returns its job before quota checks.
Only the server reads the following optional production environment variables:

| Variable | Default |
| --- | ---: |
| `DECIDE_LIMIT_NETWORK_BENCHMARK` | 2/day |
| `DECIDE_LIMIT_NETWORK_PREVIEW` | 8/day |
| `DECIDE_LIMIT_CREDENTIAL_BENCHMARK` | 2/day |
| `DECIDE_LIMIT_CREDENTIAL_PREVIEW` | 8/day |
| `DECIDE_LIMIT_GLOBAL_BENCHMARK` | 8/day |
| `DECIDE_LIMIT_GLOBAL_PREVIEW` | 40/day |
| `DECIDE_LIMIT_ACTIVE` | 4 concurrent jobs |

Daily windows reset at 00:00 UTC. Failed and cancelled jobs count toward limits.
The network comes from Vercel's overwritten `x-vercel-forwarded-for` header; never
trust a participant-supplied IP field. IPv6 addresses share a /64 bucket. Daily
HMAC hashes represent networks and provider-origin/API-key pairs; raw IPs and
plaintext keys are not stored for admission. These limits bound workload, not
individual identity; shared networks share quotas and distributed clients can
have different network buckets. Global caps still bound total accepted jobs.

Adjust limits through production environment settings and redeploy; participants
cannot change them. There is no daily approval queue or email follow-up.

```bash
node --env-file=.env.hosted.local tools/hosted-admin.mjs status --id JOB_UUID
node --env-file=.env.hosted.local tools/hosted-admin.mjs receipt --id JOB_UUID \
  --output private/receipts/recovery.json
```

The status command exposes only participant-safe fields. Receipts grant read and
cancel access; keep them private. Cancelling a running job uses the receipt or a
restricted operator SQL update that also clears `api_key_ciphertext` and the lease.

## Slack submission alerts

Create a Slack app, enable Incoming Webhooks, and add a webhook to the desired
channel using [Slack's setup guide](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/).
Add its URL as the sensitive **production-only** `DECIDE_SLACK_WEBHOOK_URL` environment
variable on `kodimo/decide-benchmark`. Add a cryptographically random `CRON_SECRET`
there as well. Keep local copies only in gitignored `.env.hosted.local`.
Apply `npm run db:setup` and deploy after configuring these variables.

Each newly accepted preview or full-benchmark job creates a notification. Slack
shows the model name, input modality, run type, question count, submission time
and evaluation ID. It receives no model keys, endpoints, receipt tokens, prompts
or transcripts. Submitter identity is not collected. Historical jobs are left
unnotified by migration `003-submission-alerts.sql`.

Alerts use the separate private `decide-submission-alerts` queue. Publication or
delivery failures never stop an evaluation. Database leases and sent markers
deduplicate consumer redelivery and repeated submissions using the same
idempotency key. The authenticated `/api/recover-submission-alerts` cron runs every
five minutes to recover queue-publication failures or expired leases. Temporary
Slack/network errors back off and honor `Retry-After`, up to 12 delivery attempts;
permanent webhook errors stop alert retries. Like other incoming-webhook systems,
an ambiguous network acknowledgment or crash after Slack accepts a message but
before the database commit can still cause a duplicate alert.

Check delivery with a restricted database query:

```sql
SELECT id, model, slack_alert_status, slack_alert_attempts,
       slack_alert_sent_at, slack_alert_error
FROM decide_jobs ORDER BY created_at DESC;
```

After fixing a configuration problem, reset only the affected jobs to
`slack_alert_status='pending'`, `slack_alert_attempts=0`, clear
`slack_alert_next_attempt_at` and any alert lease, then run:

```bash
node --env-file=.env.hosted.local tools/hosted-admin.mjs retry-alerts
```

The webhook secret is never shown in logs or public status/report responses.
Do not configure the webhook in preview environments: preview deployments must
not send production Slack messages or access the production database.

## Updating the worker data

Validate a new release on controlled infrastructure before changing the worker:

```bash
python tools/maintainer_evaluation.py validate --data data/decide-v1
python tools/pack_hosted_dataset.py --data data/decide-v1 \
  --output private/hosted/decide-v1.json.gz
```

Drain or cancel active evaluations before changing the dataset pin, so no job
mixes releases. Upload the compressed file to `hosted/decide-v1.json.gz` inside the **private** HF
repository. Configure the returned immutable commit and compressed-file hash in
Vercel, then redeploy. Do not move an existing dataset release tag. For a new
release, update the fixed version/count checks as well and deploy only after
smoke testing. The bundled reference decisions are used only inside the worker.

## Deployment and verification

```bash
npm test
python -m unittest discover -s tests -v
python tools/check_public.py
vercel project inspect --non-interactive --scope kodimo
vercel deploy --prod --scope kodimo
```

`.vercelignore` includes only public site assets, server/API modules and npm
manifests. Full local data, private receipts, keys and test artifacts are excluded.
Public assets are served from `site/`; server source is packaged as functions.
Verify a six-example self-service preview through the real queue, then check that
completion clears the encrypted model key. Verify that a failed full-run preflight
leaves its benchmark cursor at zero. Avoid running a full evaluation merely to
check connectivity; it sends 4,867 billable inference requests after preflight. Test unauthenticated receipt access
and confirm private data paths and the queue consumer have no public HTTP access.
Queue retry logs must never include upstream response bodies or private prompts.
Preview deployments intentionally lack production secrets; production is the
configured evaluation service.
