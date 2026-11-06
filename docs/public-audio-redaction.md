# Public audio privacy edits

The six website examples use six recordings. Four recordings contain client
organization identifiers.
The following intervals are replaced with a 1 kHz privacy tone:

| Clip | Start (seconds) | End (seconds) | Category |
| --- | ---: | ---: | --- |
| example-01 | 2.66 | 4.30 | Client organization |
| example-02 | 0.60 | 1.80 | Client organization |
| example-03 | 3.24 | 4.92 | Client organization |
| example-05 | 0.22 | 1.48 | Client organization |

No identifier spans were detected in examples 04 or 06. Review used existing
transcripts plus two independent ASR passes, with conservative timing margins.
This is an automated review, not a certification that every possible identifier
has been found. A maintainer should listen to the edited clips before release.

Every source PCM sample inside a selected interval is removed, including at the
tone's fade boundaries. Audio outside the intervals, frame counts, durations,
and 16 kHz mono PCM16 format are preserved. Original recordings and verbatim
audit transcripts must be kept outside this public checkout.

`site/preview/redactions.json` is the machine-readable plan. Public transcript
text uses redaction placeholders. Privacy beeps are synthetic; they should not
be counted as original call disturbance or additional speakers. Reference
decision labels remain unchanged.

## Public transcript locations

The website player displays the question and context, not a transcript. However,
the public download at `/preview/questions.jsonl` includes transcript text in
`text_request.state.clip_transcript.text` and its `segments[].text` entries.
Both representations use `[REDACTED_CLIENT]` in place of the identified names.

The refreshed Hugging Face sample parquet contains twenty questions over twenty
distinct embedded audio clips, with question, context, option and label fields.
It is separate from the website examples and replaces the earlier six-clip sample.
Its own `redactions.json` lists its privacy edits. It does not contain a
verbatim transcript column. Its text fields and dataset card must still be
checked for identifiers whenever the public samples change. The website note
beside the audio examples explains that identified PII is masked for legal and
privacy reasons.

## Maintainer tools

- `tools/redact_public_audio.py` accepts original audio from an external private
  directory, checks its hashes against the plan, and writes edited copies to a
  different directory.
- `tools/refresh_public_samples.py` builds the current twenty-clip sample from a
  private review plan and the frozen private data. It requires twenty distinct
  source rows and clips, completed independent source and post-redaction
  reviews, reviewed source/output hashes, and all six decision families. It
  preserves the frozen labels, de-identifies public context/options and stages
  only the four public release files outside this checkout. `--publish` updates
  only `tazolabs/DECIDE-samples`, with a parent-commit guard and anonymous download
  verification; it checks that the full benchmark stays private and unchanged.
- `tools/publish_redacted_samples.py` is the legacy six-clip publisher. It stages updated public parquet, metadata
  and dataset-card files. It requires `huggingface_hub` and `pyarrow`. Supply
  reviewed text replacements in a separate private JSON file. Publication
  requires the explicit `--publish` flag and uses a parent-commit check. Only
  `tazolabs/DECIDE-samples` is writable; the full private benchmark is checked
  before and after without being modified.
- Never use the legacy publisher to refresh the twenty-clip release. Its expected
  clip-set check deliberately rejects the new release.
- `tools/export_private.py --write-previews` refuses to overwrite this redacted
  release with raw recordings.

After preparing and reviewing a private plan, use an empty external staging
directory. Omit `--publish` for a dry run:

```bash
python tools/refresh_public_samples.py --review-plan /path/to/private-review.json \
  --source-data /path/to/frozen-data --output /path/to/empty-staging --publish
```

The plan contains one entry per public row, its frozen source row ID, opaque
public aliases, de-identified question/context, scenario, ordered replacement
intervals and categories, source/reviewed output SHA256s, and completed review
flags. Global tone settings and private text-replacement patterns are also
required. Do not commit this plan or verbatim review transcripts.

Updating the current release does not remove earlier GitHub/Hugging Face
revisions, Git/LFS objects, cached dataset-viewer conversions, or copies already
downloaded by others. Removing those requires a separate history/cache cleanup
with the repository hosts. Do not describe the current-file update as erasing
all previously public copies.
