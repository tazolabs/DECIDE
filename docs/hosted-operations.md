# Hosted evaluator operations

## Architecture

`POST /api/evaluations` validates an endpoint-bound invitation, encrypts the model
key and creates a job atomically in Neon Postgres. Vercel Queues delivers only its
opaque ID to the private `api/consume.mjs` consumer in `iad1`. The worker reads the
pinned private Hugging Face bundle, validates audio hashes, calls the model, and
updates aggregate counters and a durable cursor. Batches contain three questions.
Queue redelivery resumes the cursor, with a database lease preventing concurrent
workers for one job. Each completed batch publishes the next one before ack.

The worker never executes participant code. Model operators see inference inputs;
participants do not receive dataset downloads, reference labels or per-row outputs.
At most four jobs can be active globally. Invitations impose additional quotas.

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

Keep these in Vercel production environment settings and a gitignored
`.env.hosted.local` for operator commands. Do not put them in public browser
variables, logs or repository files. Preserve the encryption key: changing it
invalidates old receipts and prevents decrypting active jobs. It encrypts model
keys with AES-256-GCM and derives result tokens. Model keys are cleared when jobs
complete, fail or are cancelled; invite tokens are stored only as SHA-256 hashes.

```bash
npm ci
npm run db:setup
node --env-file=.env.hosted.local tools/hosted-admin.mjs invite \
  --endpoint https://api.example.com/v1/decisions --name participant \
  --max-runs 2 --days 7 --output private/invitations/participant.json
```

Share that invitation file privately. An invitation counts a run when accepted,
including failed/cancelled jobs, so allow a preview run plus a benchmark run.
For operator smoke tests only, `--max-questions 3` limits private input use; the
returned scope is `operator_smoke_test`, never `full_benchmark`.

```bash
node --env-file=.env.hosted.local tools/hosted-admin.mjs status --id JOB_UUID
node --env-file=.env.hosted.local tools/hosted-admin.mjs receipt --id JOB_UUID \
  --output private/receipts/recovery.json
```

The status command exposes only participant-safe fields. Receipts grant read and
cancel access; keep them private. Revoke an invitation by expiring its database
record. Cancelling a running job uses the receipt or a restricted operator SQL
update that also clears `api_key_ciphertext` and the lease.

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
Verify the real queue path using an operator smoke invitation, then check that
completion clears the encrypted model key. Test unauthenticated receipt access
and confirm private data paths and the queue consumer have no public HTTP access.
Queue retry logs must never include upstream response bodies or private prompts.
Preview deployments intentionally lack production secrets; production is the
configured evaluation service.
