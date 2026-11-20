# Website leaderboard

The `/leaderboard` page reads the aggregate snapshot at `site/data/leaderboard.json`. It exposes model-level accuracy, estimated run cost, latency, DBS and the top five models for voice-based properties. It contains no benchmark questions, reference labels, transcripts, audio or private source paths.

The table defaults to DBS, descending. Accuracy sorts descending and latency ascending. The voice-properties highlight shows Tazo's actual rank among all published models, regardless of its position. The table below shows five models by accuracy, with DBS as the tie break. The underlying snapshot retains all five task-family aggregates.

Model subtitles show `Direct audio` or `STT + text` according to input modality.
Cost and latency cells display their numeric values. Measurement methods are
recorded in the snapshot metadata and documentation.

DBS uses equal-weight geometric averaging:

```text
100 × [A × Cmed/(Cmed+C) × Lmed/(Lmed+L)]^(1/3)
```

Accuracy `A` is a fraction. Cost `C` is the estimated standalone benchmark cost, including STT when applicable. Latency `L` follows the recorded measurement basis: mean pipeline latency for existing runs and elapsed run time per question for hosted submissions. The snapshot records fixed reference medians in matching units. Tazo uses the supplied optimized 474 ms mean; Qwen2.5 Omni latency values are estimates from measurements. Accuracy uses the full benchmark denominator, including failed predictions.

The frontier is computed from raw accuracy/cost and latency. The horizontal axis is a normalized latency index, `100 × L/(L + Lmed)`, using the fixed reference median in the snapshot. It is dimensionless, bounded between 0 and 100, and strictly increases with latency; 50 is the median and lower is faster.

The vertical axis is a normalized efficiency index, `100 × E/(E + Emed)`, where `E = accuracy/run cost` and `Emed` is the median efficiency of all models in the published snapshot. Higher is better and 50 is the reference median. This bounded, saturating scale reflects actual measurements: similar efficiencies stay close together, and the leader is not automatically assigned 100. Twice the reference efficiency scores 66.67; half scores 33.33. The index is invariant to the currency unit when the reference is converted too. The efficiency median is recalculated from the published model set; the DBS reference constants stay fixed.

The favorable quadrant is the top left. These monotonic transformations preserve the raw Pareto dominance relationships: a frontier model is not beaten on both accuracy per dollar and latency, with one strict improvement. A “Pareto Frontier” label follows the longest segment of the line; space for that label is reserved when placing model names.

Every model is labelled on the chart. Labels may move for legibility, with leader lines retaining the exact data-point locations. On small screens, the plot scrolls horizontally to keep those names readable. Hover, keyboard focus or tap shows raw accuracy, run cost and latency next to the point; Escape dismisses the tooltip.

The voice table displays model names, company names and accuracies without company logos.

## Hosted submission estimates

The snapshot includes 25 eligible models: the original 20, Nirnaya Flash,
Nirnaya Turbo, SPEV, Laya and Gemini Decision 1. See [the community source calculations and assumptions](community-submissions.md).
Hosted-submission latency is the recorded full run duration divided by all 4,867
questions, including evaluator overhead. These values enter the existing score
and frontier calculations. Nirnaya and Laya costs use full run hours × a one-H100 PCIe reference
rate. This is an explicit pricing assumption; recorded run times are unchanged.
SPEV's estimate uses its published token rates, the current public text tokenizer
and prompt formatting, and the supplied 25-audio-token/second assumption.

All published entries must have positive cost and latency values. Unpriced
submissions are excluded rather than shown as pending ranked entries. Model
counts, Tazo's voice-properties rank and chart descriptions are derived from the snapshot.
Fixed DBS reference constants remain unchanged.

## Gemini Decision 1

The native Google Decisions API receives original audio, the same frozen state
and the same question instructions/options, one question per request. The API
sorts option keys alphabetically internally. Only completed full-dataset reports
on the approved fingerprint can be imported. Failures remain incorrect in the
4,867-question denominator.

Cost uses the API's returned text/audio input-token usage at the standard paid
rate of $0.10 per million tokens, checked 20 November 2026. Output tokens are zero.
Recorded responses from retries/reruns are included; cached answers are not
charged again. Latency is the measured final successful HTTP request mean,
including network and upload, matching the other direct Google entries.
The report also retains median, p95 and amortized invocation runtime separately.

The importer allowlists aggregate metrics; raw prompts, answers, audio, keys and
per-row predictions remain private. It rejects partial reports, missing usage,
changed datasets, inconsistent family counts or unreconciled pricing. Pricing is
a published-rate estimate, not a cloud invoice or free-tier credit calculation.

Sources: [API](https://aistudio.google.com/docs/decisions-api),
[pricing](https://aistudio.google.com/docs/pricing#gemini-decision).

The 20 November 2026 run completed all 4,867 questions without unresolved errors:
3,483 correct (**71.56%**), **$1.2138589** at published rates, and **891.50 ms** mean
HTTP latency (705.73 ms median; 1,802.37 ms p95). Returned usage contains
10,440,966 text and 1,697,623 audio tokens. DBS is **71.21** using the existing
reference constants. Tazo's voice-properties rank remains **#2** among 25 models.

## Refreshing the snapshot

Export an approved original-model aggregate report, then import hosted submissions:

```bash
node tools/export-leaderboard.mjs --source /path/to/analysis.json --output site/data/leaderboard.json
node tools/import-hosted-submissions.mjs \
  --jobs private/exported-hosted-jobs.json \
  --metadata docs/community-submissions.json \
  --snapshot site/data/leaderboard.json
node tools/import-gemini-decisions.mjs \
  --report private/gemini-decision-1-report.json \
  --snapshot site/data/leaderboard.json
npm test
```

Both tools allowlist aggregate fields. Review the snapshot and PR before merging.
The page uses the existing static Vercel deployment and requires no new credentials.
