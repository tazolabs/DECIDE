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

## Hosted evaluation and privacy

Participants submit configuration for an approved external model API. The worker
retrieves the pinned private release, sends only the corresponding inference
request, and accumulates metrics against private references. The API operator
receives audio or STT text and permitted context. The service therefore keeps the
dataset files and labels private without claiming to hide inference inputs from
the model operator.

Invitation tokens are scoped to a specific HTTPS endpoint and bounded run quota.
The worker blocks private-network destinations and redirects, validates every
prediction, and applies bounded retries. Inference is at least once: providers
should honor the opaque `Idempotency-Key` header when supported. Missing/invalid
responses count as incorrect; repeated failures can stop a job. Only completed
jobs return aggregate metrics. Cells with fewer than ten questions are withheld.
No raw prompts, labels, private IDs or per-question outputs are returned to the
submitter. Status and cancellation require the private result receipt.

Private storage credentials belong only on operator infrastructure. Public local
commands run the six previews. The internal operator entry point is separate from
the hosted participant API and is not an isolation sandbox for untrusted code.
Data and references are versioned independently of mutable app annotations; new
annotations require a new dataset tag and new outputs.
