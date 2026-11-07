# Website leaderboard

The `/leaderboard` page reads the aggregate snapshot at `site/data/leaderboard.json`. It exposes model-level accuracy, estimated run cost, mean latency, DBS and the top five models for voice-based properties. It contains no benchmark questions, reference labels, transcripts, audio or private source paths.

The table defaults to DBS, descending. Accuracy sorts descending and latency ascending. The voice-properties table shows five models by accuracy, with DBS as the tie break. The underlying snapshot retains all five task-family aggregates.

DBS uses equal-weight geometric averaging:

```text
100 × [A × Cmed/(Cmed+C) × Lmed/(Lmed+L)]^(1/3)
```

Accuracy `A` is a fraction. Cost `C` is the estimated standalone benchmark cost, including STT when applicable. Latency `L` is the mean pipeline latency. The snapshot records fixed reference medians in matching units. Tazo uses the supplied optimized 474 ms mean; Qwen2.5 Omni latency values are estimates from measurements. Accuracy uses the full benchmark denominator, including failed predictions.

The frontier is computed from raw accuracy/cost and latency. The horizontal axis is a normalized latency index, `100 × L/(L + Lmed)`, using the fixed reference median in the snapshot. It is dimensionless, bounded between 0 and 100, and strictly increases with latency; 50 is the median and lower is faster. The vertical axis is the midrank percentile of accuracy/cost; higher is more efficient. The favorable quadrant is therefore the top left. These monotonic transformations preserve the raw Pareto dominance relationships: a frontier model is not beaten on both accuracy per dollar and latency, with one strict improvement.

Every model is labelled on the chart. Labels may move for legibility, with leader lines retaining the exact data-point locations. On small screens, the plot scrolls horizontally to keep those names readable. Hover, keyboard focus or tap shows raw accuracy, run cost and mean latency next to the point; Escape dismisses the tooltip.

Company marks in the voice table are local assets sourced from their official websites; see `site/assets/brand/SOURCES.md`. No third-party image request is made by visitors.

To refresh from an approved internal aggregate report:

```bash
node tools/export-leaderboard.mjs --source /path/to/analysis.json --output site/data/leaderboard.json
npm test
```

The exporter deliberately selects public aggregate fields and validates all accuracies and DBS values. Review the resulting JSON and PR before merging. The page uses the existing static Vercel deployment and requires no new service or credentials.
