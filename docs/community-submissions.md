# Community submission estimates

Checked 20 November 2026. Four completed hosted submissions have both latency
and cost estimates and are included alongside the original 20 models. Accuracy
is correct / 4,867, including failed predictions as incorrect. Previews and smoke
tests are excluded.

| Model | Correct | Failed | Accuracy | Recorded full-run time | Time per question | Estimated run cost |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| Nirnaya Turbo 1.0 | 3,494 | 0 | 71.79% | 2h 02m 34.381s | 1,511.07 ms | $4.07 |
| SPEV | 3,458 | 4 | 71.05% | 2h 08m 07.220s | 1,579.46 ms | $3.90 |
| Nirnaya Flash 1.0 | 3,195 | 0 | 65.65% | 1h 59m 29.549s | 1,473.09 ms | $3.96 |
| Laya (EmbeddingLabs submission) | 525 | 0 | 10.79% | 3h 08m 50.687s | 2,328.06 ms | $6.26 |

## Latency method

For each complete run:

```text
latency_ms = (report.completed_at - created_at) / 4,867
```

The numerator is in milliseconds. Millisecond precision is preserved for both
ISO timestamps and database Date values. If the report completion timestamp is
unavailable, updated_at is the documented fallback for a completed run.

These values are estimates of elapsed hosted run time per question. They include
queueing, the evaluator's one-second pauses, retries, storage downloads and
database work. They are not isolated model/server response latency. Existing
leaderboard entries retain their documented latency bases, so the website marks
these new entries “Run time ÷ 4,867” and notes the evaluator overhead.

## Cost method

For Nirnaya and Laya:

```text
estimated_cost_usd = elapsed_ms / 3,600,000 × GPU_count × hourly_rate_usd
```

The reference rate is **$1.99 per GPU hour**, the published Runpod Community Cloud
rate for one [NVIDIA H100 PCIe 80 GB](https://www.runpod.io/gpu-models/h100), checked
20 November 2026. This is a reference compute estimate, not the submitter's
invoice. It assumes one GPU remains allocated throughout the recorded run;
storage, tax and other fees are excluded. Runpod also lists a different Secure
Cloud rate; this calculation specifically uses the Community Cloud rate.

- Flash's recorded run lasted 1.991541389 hours; one reference H100 costs $3.963167364 for that interval. Its submitter reported an H200; H100 is the chosen reference cost assumption.
- Turbo's recorded run lasted 2.042883611 hours; one reference H100 costs $4.065338386. Its actual GPU type is unspecified.
- Laya's recorded run lasted 3.147413056 hours; one reference H100 costs $6.263351981. Its actual hardware and API price are unspecified.
- These estimates retain the recorded run windows. H100 performance has not been remeasured, and the reference GPU is not a claim about the original hardware or actual bill.
- SPEV uses the [provider's published rates](https://sprag.ai/spev): $2 per million
  audio input tokens and $0.09 per million text input tokens, with no output charge.
  Across all 4,867 requests, 56,158.87 audio seconds at an assumed 25 tokens/second
  gives 1,403,971.75 estimated audio tokens ($2.8079435). Tokenizing all prompts,
  context and criteria with the current published SPEV tokenizer and processor
  formatting gives 12,188,426 text tokens ($1.09695834), for **$3.90490184 total**.
  The tokenizer/format revision and assumptions are stored in the metadata.
  The 25 audio-token/second rate is a supplied reference, not verified SPEV usage;
  historical adapter differences and retry/preflight charges are not reconstructed.
  This replaces the submitter's approximate $1.50 estimate rather than treating
  either value as an invoice.

The same fixed DBS reference constants and score formula apply to all eligible
models. These four models now have DBS scores and Pareto-chart points.

## Laya cost basis

Laya originally lacked a cost because neither a provider price nor a hardware
configuration was supplied. Duration alone does not determine a dollar charge.
It is now included using the same one-H100 reference-GPU assumption as Nirnaya.
This makes its estimated compute cost explicit without treating it as observed
API billing. Follow-up drafts remain unposted.

## Rebuilding the public snapshot

Maintainer-only input contains the hosted job reports and their run timestamps:

```bash
node tools/import-hosted-submissions.mjs \
  --jobs private/exported-hosted-jobs.json \
  --metadata docs/community-submissions.json \
  --snapshot site/data/leaderboard.json
npm test
```

The importer validates complete runs and family totals, derives latency from the
recorded timestamps, derives GPU cost from the chosen rate, and computes DBS. It
skips entries with no supported cost. Only aggregate fields are exported; model
endpoints, credentials, transcripts, questions and labels stay private.
