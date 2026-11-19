# Community submission estimates

Checked 20 November 2026. Three completed hosted submissions have both latency
and cost estimates and are included alongside the original 20 models. Accuracy
is correct / 4,867, including failed predictions as incorrect. Previews and smoke
tests are excluded.

| Model | Correct | Failed | Accuracy | Recorded full-run time | Time per question | Estimated run cost |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| Nirnaya Turbo 1.0 | 3,494 | 0 | 71.79% | 2h 02m 34.381s | 1,511.07 ms | $7.33 |
| SPEV | 3,458 | 4 | 71.05% | 2h 08m 07.220s | 1,579.46 ms | ~$1.50 |
| Nirnaya Flash 1.0 | 3,195 | 0 | 65.65% | 1h 59m 29.549s | 1,473.09 ms | $7.15 |

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

For the Nirnaya models:

```text
estimated_cost_usd = elapsed_ms / 3,600,000 × GPU_count × hourly_rate_usd
```

The reference rate is **$3.59 per GPU hour**, the published Runpod Community Cloud
rate for one [NVIDIA H200 141 GB](https://www.runpod.io/gpu-models/h200), checked
20 November 2026. This is a reference compute estimate, not the submitter's
invoice. It assumes one GPU remains allocated throughout the recorded run;
storage, tax and other fees are excluded. Runpod also lists a different Secure
Cloud rate; this calculation specifically uses the Community Cloud rate.

- [Nirnaya Flash's submission](https://github.com/tazolabs/DECIDE/issues/21)
  specifies one H200. Its 1.991541389 run hours × $3.59 gives $7.149633586.
- Turbo is estimated using the same one-H200 configuration as Flash; its GPU
  type is not independently confirmed. Its
  2.042883611 run hours × $3.59 gives $7.333952164. This hardware assumption remains
  recorded in the public measurement metadata.
- [SPEV's submission](https://github.com/tazolabs/DECIDE/issues/20) estimates
  approximately **$1.50 for the full run**. The [provider's SPEV page](https://sprag.ai/spev)
  confirms $2 per million audio input tokens, $0.09 per million text/image input
  tokens, and no output charge. Duration alone cannot reconstruct token billing;
  the leaderboard retains the attributed full-run cost estimate.

The same fixed DBS reference constants and score formula apply to all eligible
models. These three models now have DBS scores and Pareto-chart points.

## Unpriced submission

Laya's EmbeddingLabs submission scored 525 / 4,867 = **10.79%**, with no failed
predictions. Its recorded run lasted 3h 08m 50.687s, giving **2,328.06 ms/question**
under the same latency formula. No price or hardware configuration is available,
so a supported cost cannot be calculated. It remains in the review metadata and
is excluded from the ranked leaderboard until pricing is available. No one has
been contacted; follow-up drafts remain unposted.

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
