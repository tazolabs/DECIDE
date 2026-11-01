# Evaluation protocol

DECIDE is an offline, bounded-choice evaluation. It measures agreement with human
reference decisions at the end of an audio clip, not success of an executed tool
or the outcome of an entire live call.

## Inputs and evidence

- Use the supplied clip without extending the audio boundary.
- Use only the accompanying context; earlier dialogue is supplied only where
  relevant to the question. Do not reconstruct later dialogue.
- Speaker roles are agent/assistant and caller/user. Anonymous STT speaker IDs
  do not establish those roles by themselves.
- Graphs and tool inventories are inferred benchmark configurations, not
  verified production execution logs.
- Current-node context describes the start of the clip. Choose the action and
  destination supported at the end of the clip.
- Questions about speakers, disturbance, emotion and language use their stated
  clip-local evidence scope.
- Never include the reference label, annotator notes or model predictions from
  another evaluation in the inference prompt.

## Recorded prompts

The private release includes an `audio_request` and `text_request` for every
question. These preserve the prompts used in the corresponding reported
comparison. Text requests include frozen Sarvam STT output and modality guidance.
Per-question STT settings are included. The recorded pipeline prompts may differ;
the evaluator does not assert that their comparison isolates audio modality.

Provider model IDs are supplied at inference time and are not part of a question's
gold label. Ordered criterion IDs and descriptions are sent in their stored order.
Keep this order for standard evaluation. Record prompt or option-order experiments
as a different condition, rather than overwriting an existing run.

The six public demonstrations use shortened context and do not reproduce the
full evaluation prompts. Their scores are integration checks only.

## Metrics

- **Accuracy:** exact top-1 matches divided by all selected questions. Missing
  predictions and explicit errors count as incorrect.
- **Accepted accuracy:** a prediction may match any supplied accepted label. In
  v1.0 each row has one accepted label, so this equals exact accuracy.
- **Task macro accuracy:** arithmetic mean of per-task accuracies across the
  selected tasks. Tiny tasks receive the same task weight as large tasks.
- **Coverage:** fraction of questions with a valid prediction. Accuracy on valid
  predictions is supplementary and must not replace the all-question denominator.

Report the dataset version, selected question/task counts, provider and model
versions, modality, changes to prompts/STT, coverage, accuracy and task macro.
Questions sharing an audio clip or source call are correlated. If reporting
confidence intervals, resample source-call groups, not independent question rows.

## Privacy and versions

Authentication is needed to download the full dataset. The evaluator is a local
tool for authorized users, not a public endpoint exposing private data or labels.
Data and references are versioned independently of mutable app annotations. New
annotations should produce a new dataset tag and new evaluation outputs.
