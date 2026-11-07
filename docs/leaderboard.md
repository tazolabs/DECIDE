# Website leaderboard

The `/leaderboard` page reads the aggregate snapshot at `site/data/leaderboard.json`. It exposes model-level accuracy, estimated run cost, mean latency, DBS and the top five models for voice-based properties. It contains no benchmark questions, reference labels, transcripts, audio or private source paths.

The table defaults to DBS, descending. Accuracy sorts descending and latency ascending. The voice-properties table shows five models by accuracy, with DBS as the tie break. The underlying snapshot retains all five task-family aggregates.

DBS uses equal-weight geometric averaging:

```text
100 × [A × Cmed/(Cmed+C) × Lmed/(Lmed+L)]^(1/3)
```

Accuracy `A` is a fraction. Cost `C` is the estimated standalone benchmark cost, including STT when applicable. Latency `L` is the mean pipeline latency. The snapshot records fixed reference medians in matching units. Tazo uses the supplied optimized 474 ms mean; Qwen2.5 Omni latency values are estimates from measurements. Accuracy uses the full benchmark denominator, including failed predictions.

The frontier is computed from raw accuracy/cost and latency. The horizontal axis is a normalized latency index, `100 × L/(L + Lmed)`, using the fixed reference median in the snapshot. It is dimensionless, bounded between 0 and 100, and strictly increases with latency; 50 is the median and lower is faster.

The vertical axis is a normalized efficiency index, `100 × E/(E + Emed)`, where `E = accuracy/run cost` and `Emed` is the median efficiency of all models in the published snapshot. Higher is better and 50 is the reference median. This bounded, saturating scale reflects actual measurements: similar efficiencies stay close together, and the leader is not automatically assigned 100. Twice the reference efficiency scores 66.67; half scores 33.33. The index is invariant to the currency unit when the reference is converted too. For the current snapshot, Tazo scores 58.23 and Perceptron scores 69.61.

The favorable quadrant is the top left. These monotonic transformations preserve the raw Pareto dominance relationships: a frontier model is not beaten on both accuracy per dollar and latency, with one strict improvement. A “Pareto Frontier” label follows the longest segment of the line; space for that label is reserved when placing model names.

Every model is labelled on the chart. Labels may move for legibility, with leader lines retaining the exact data-point locations. On small screens, the plot scrolls horizontally to keep those names readable. Hover, keyboard focus or tap shows raw accuracy, run cost and mean latency next to the point; Escape dismisses the tooltip.

The voice table displays model names, company names and accuracies without company logos.

To refresh from an approved internal aggregate report:

```bash
node tools/export-leaderboard.mjs --source /path/to/analysis.json --output site/data/leaderboard.json
npm test
```

The exporter deliberately selects public aggregate fields and validates all accuracies and DBS values. Review the resulting JSON and PR before merging. The page uses the existing static Vercel deployment and requires no new service or credentials.
