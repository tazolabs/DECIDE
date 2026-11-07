# Website leaderboard

The `/leaderboard` page reads the aggregate snapshot at `site/data/leaderboard.json`. It exposes model-level accuracy, estimated run cost, mean latency, DBS and five task-family accuracies. It contains no benchmark questions, reference labels, transcripts, audio or private source paths.

The table defaults to DBS, descending. Accuracy sorts descending and latency ascending. Task summaries show three models per family by accuracy, with DBS as the tie break.

DBS uses equal-weight geometric averaging:

```text
100 × [A × Cmed/(Cmed+C) × Lmed/(Lmed+L)]^(1/3)
```

Accuracy `A` is a fraction. Cost `C` is the estimated standalone benchmark cost, including STT when applicable. Latency `L` is the mean pipeline latency. The snapshot records fixed reference medians in matching units. Tazo uses the supplied optimized 474 ms mean; Qwen2.5 Omni latency values are estimates from measurements. Accuracy uses the full benchmark denominator, including failed predictions.

The frontier is computed from raw accuracy/cost and latency. The chart places those metrics on midrank-percentile axes; its spacing shows ranks rather than proportional differences. A point belongs to the frontier only when no other model has at least as much accuracy per dollar and at most as much latency, with one strict improvement.

To refresh from an approved internal aggregate report:

```bash
node tools/export-leaderboard.mjs --source /path/to/analysis.json --output site/data/leaderboard.json
npm test
```

The exporter deliberately selects public aggregate fields and validates all accuracies and DBS values. Review the resulting JSON and PR before merging. The page uses the existing static Vercel deployment and requires no new service or credentials.
