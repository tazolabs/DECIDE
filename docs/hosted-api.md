# Model API contract

The hosted evaluator calls your public **HTTPS POST endpoint**. Submission is
self-service: no invitation, email, account or manual approval is needed. Use an adapter
endpoint if your provider has a different schema. The endpoint must accept every
question's supplied option IDs and return one of them without changing the task.
The service automatically validates the URL and public DNS addresses. Query-string credentials, redirects,
IP literals and private-network destinations are not accepted.

## Requests

For **audio** mode the body is `multipart/form-data` with:

- `request`: JSON string with `model`, `state` and `questions`.
- `audio`: the exact WAV clip, with filename `clip.wav` and type `audio/wav`.

For **text** mode the body is `application/json` containing that request object.
The frozen STT transcript is in `state.clip_transcript`. No audio is sent in text
mode. Both modes use the versioned prompts from the release; audio and text
prompts may have modality-specific differences.

A minimal request shape (illustrative only):

```json
{
  "model": "my-model-version",
  "state": {"context": "Permitted conversation context"},
  "questions": {
    "action": {
      "type": "choice",
      "instructions": "Who should speak immediately after this clip?",
      "criteria": {
        "agent": "The agent should speak.",
        "caller": "The caller should speak.",
        "end_call": "The conversation should end.",
        "insufficient_evidence": "The available evidence does not support a decision."
      }
    }
  }
}
```

Use the complete supplied `state`, instructions and criteria. Criteria vary by
question; preserve IDs and order. The worker does not send references, annotator
notes, private row IDs or Hugging Face credentials. A supplied model API key is
sent only as `Authorization: Bearer <key>`. Without a key that header is omitted.
An opaque `Idempotency-Key` identifies a question within a job; honor it if possible.

## Responses

Return HTTP 200 and either a simple response:

```json
{"choice": "caller"}
```

or a native decision response:

```json
{
  "model": "my-model-version",
  "answers": {
    "action": {
      "type": "choice",
      "choice": "caller",
      "probabilities": {"agent": 0.1, "caller": 0.8, "end_call": 0.05, "insufficient_evidence": 0.05}
    }
  }
}
```

`probabilities` is optional. When provided, it must contain exactly the allowed
IDs, finite values between 0 and 1 summing to 1 (tolerance 0.001), and `choice`
must be a maximum-probability option. If `model` is provided it must match the
requested ID. Responses are limited to 512 KiB and requests time out after 45 s.

Before a full run, the worker sends one public preview question using the chosen
modality and validates your response. If this fails, the job stops without sending
private inputs. This check is not included in benchmark scores. Preview runs already
use public data and do not add a separate preflight request.

Each job sends serial requests with a one-second pause. HTTP 408/429 and selected
5xx errors receive up to four attempts per question, honoring `Retry-After` up
to five minutes. Authentication/configuration failures stop the job immediately;
five consecutive invalid/failed predictions stop it. Other invalid or missing
responses count as incorrect. Queue delivery is at least once; a request can be
repeated after a worker restart. Cancellation stops future requests, but cannot
recall an in-flight request.

## Results and access

The [submission page](https://decide-benchmark.vercel.app/evaluate) and public CLI
create the same jobs. Keep the private receipt: it authorizes status, cancellation
and aggregate report retrieval. Closing the page does not stop a job. No labels,
per-question records, private transcripts or dataset-download links appear in
results. Cells below ten questions are suppressed. Preview results are integration
checks, not full-benchmark scores.

Your model endpoint's operator receives and can observe inference inputs. Dataset
files and reference labels stay on our infrastructure.

## Automatic run limits

Submissions are admitted automatically. Daily limits apply to the submitting
network and the combination of provider origin and API credential, with global
daily and concurrent-job caps. Failed and cancelled jobs also consume a run.
Switching model IDs or endpoint paths does not bypass the credential limit. IPv6
addresses in one /64 share a network limit. Only daily salted hashes are stored
for these limits, not raw IP addresses or plaintext keys. Shared office networks
share a limit; these are resource controls, not verified personal identities.

A limit response is HTTP 429 with `Retry-After`. Daily limits reset at 00:00 UTC;
capacity limits can be retried sooner. Reuse the original idempotency key/receipt
when retrying. An already-created identical job is returned even if a quota has
since been reached. Quotas cannot be raised through submission JSON.
