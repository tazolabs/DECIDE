# Community submission review

Checked 20 November 2026. Four completed hosted submissions cover all **4,867**
questions each. Accuracy is `correct / 4,867`; failed predictions remain incorrect.
Previews, operator smoke tests and the Slack notification mock are not leaderboard entries.

| Submitted model | Correct | Failed | Accuracy | Full-run cost | Client mean latency |
| --- | ---: | ---: | ---: | --- | --- |
| Nirnaya Turbo 1.0 | 3,494 | 0 | 71.79% | Pending | Pending |
| SPEV | 3,458 | 4 | 71.05% | ~$1.50, submitter estimate | Pending |
| Nirnaya Flash 1.0 | 3,195 | 0 | 65.65% | Pending | Pending |
| Laya (EmbeddingLabs submission) | 525 | 0 | 10.79% | Pending | Pending |

The recorded family results put **Nirnaya Turbo first on voice properties** at
1,568 / 1,886 = **83.14%**, followed by Tazo at 1,558 / 1,886 = **82.61%**.
The website derives this highlight from the data, rather than hardcoding a winner.

## Cost evidence

- [SPEV submission](https://github.com/tazolabs/DECIDE/issues/20): approximately
  $1.50 for the complete run. The quoted rates, also confirmed on the
  [provider's SPEV page](https://sprag.ai/spev), are $2 per million audio input
  tokens, $0.09 per million text/image input tokens and no output charge. The
  $1.50 figure is a submitter estimate, not observed billing. Average estimated
  cost per benchmark question is $1.50 / 4,867, approximately $0.000308.
- [Nirnaya submission and follow-up](https://github.com/tazolabs/DECIDE/issues/21):
  self-hosted; no API price or total billed compute time was provided. Flash's
  reported 180 ms is a same-machine HTTP **median**, not a mean. Turbo reports a
  243 ms server-side mean and 185 ms median. These values are kept as attributed
  context; they do not supply the client-mean column or a speculative GPU bill.
- No Laya pricing or hardware/runtime information was supplied in the public
  issues. No cost is invented for it.

DBS and frontier eligibility require both a positive run-cost estimate and a
mean client latency. Missing values are `null`, displayed as **Pending**, and
sort after measured entries for DBS/latency. All submissions participate in
accuracy and task-family rankings. Fixed DBS reference values are unchanged.

## Access checks and timing protocol

The saved Nirnaya temporary tunnels no longer resolve. A single public-preview
probe of each saved SPEV and Laya endpoint returned HTTP 404. Original model API
keys are erased at terminal job states, so they cannot be recovered from the
completed submissions. No private benchmark inputs were sent during these probes.

Consequently, **no 500-sample latency measurement has been completed** for these
four models. Request a restored endpoint and a credential from each owner. A
current SPEV endpoint may serve an updated model: confirm the served revision
matches the original accuracy run, or evaluate its accuracy again before
combining it with new efficiency measurements. Do not infer model latency by
dividing hosted job wall time by questions; that includes queue delivery,
database work, intentional pauses and retries.

The maintainer timing script uses the **same 500 deterministic random questions**
for each model, seed `decide-community-latency-v1`, preserving frozen prompts and
options. It first checks one public example, excluded from timing, before loading
private data. Requests are serial with a one-second pause; transient errors retry
up to three times and honor provider delays. Five consecutive failures, or an
authentication/configuration failure, stop the run. Successful rows are cached;
rerunning retries only failed/missing rows. Receipts and keys are not needed in
public output. Run artifacts stay under ignored `private/` paths.

Mean latency measures a complete successful model request, including DNS, input
upload, response receipt and validation. Audio/storage download, deliberate pauses
and retry backoff are outside that timer. Failed attempt durations and coverage
are retained separately. A summary becomes publication-ready after 500 valid
timed predictions. It does not replace or rescore the stored full-run accuracy.

```bash
# Restore the endpoint and put its API key in the maintainer environment first.
node --env-file=.env.hosted.local tools/measure-submission-latency.mjs \
  --model spev --endpoint https://YOUR_RESTORED_HOST/v1/decisions \
  --api-key-env SPEV_API_KEY --model-revision OWNER_CONFIRMED_REVISION \
  --output private/submission-latency/spev
```

Use `nirnaya-flash-1.0`, `nirnaya-turbo-1.0` or `laya-embeddinglabs` with the
respective restored endpoint and key variable. Omit `--api-key-env` only for an
endpoint its owner intentionally makes unauthenticated. No app API route or
private dataset access is added for public participants.

After measurement, update that entry's latency in `docs/community-submissions.json`
to `{"status":"measured","value_ms":MEAN,"sample_n":500}` with its source/basis.
Supply documented pricing before completing its cost. Import aggregates using:

```bash
node tools/import-hosted-submissions.mjs \
  --jobs private/exported-hosted-jobs.json \
  --metadata docs/community-submissions.json \
  --snapshot site/data/leaderboard.json
npm test
```

The importer checks complete runs and family totals, computes accuracy using all
4,867 questions, derives DBS only when both measurements are present, and omits
API endpoints, credentials, question rows and reference labels from the snapshot.
