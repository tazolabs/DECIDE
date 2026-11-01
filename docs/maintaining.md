# Maintainer guide

## Dataset access

The full dataset lives in the **private** Hugging Face dataset repository
`tazolabs/DECIDE`. Restrict read access to benchmark operators and controlled
evaluation workers. Do not grant dataset access to participants, model submitters
or their inference endpoints. Never make the repository public or place a Hugging
Face token in the website. The current website is static; a public hosted
submission service has not yet been implemented.

`evaluation.py` is preview-only. On operator-controlled infrastructure, internal
evaluation remains available through `tools/maintainer_evaluation.py`:

```bash
python tools/maintainer_evaluation.py download --revision v1.0
python tools/maintainer_evaluation.py validate --data data/decide-v1
```

The separate entry point is a workflow distinction, not a security boundary.
Storage credentials and execution isolation must enforce privacy. Do not return
private per-question logs, text, audio, predictions or reference labels to
participants. Use reviewed aggregate reports for full benchmark results.

The public release exposes six explicitly selected preview questions and clips.
Do not copy the original call corpus, app backups or evaluation run directories
into this repository. Code licensing does not cover audio/data rights.

## Dataset updates

The v1.0 release freezes the paper's final question membership and labels.
Do not mutate or move its tag to incorporate later annotations. Prepare a new
version and rerun validation and evaluations when labels change.

`tools/export_private.py` rebuilds the initial v1.0 release from the private source
checkout. Its output must be **outside this public repository**. It verifies the
recorded request-file hashes and original audio hashes before exporting only the
final benchmark membership. It does not connect to or edit the annotation app.

```bash
python tools/export_private.py --source /path/to/private-source \
  --output /path/outside/public-repo/decide-private-v1
```

`--write-previews` explicitly rewrites the six allowlisted public clips and prompts.
Review clip transcripts and bounded context for personal details before using it
with a different source snapshot. No other examples are exported publicly.

The private bundle includes source/prompt/cohort provenance for audit. Do not claim
that comparison prompts are identical or that a recorded system comparison
isolates input modality.

## Website

All served files are in `site/`. No build framework or external storage integration
is needed. Vercel's project `decide-benchmark` is in the Kodimo team and is linked
to `tazolabs/DECIDE`. The `.vercelignore` file allows only `site/` and `vercel.json`
into deployment uploads, even if someone downloads private data locally.

```bash
python3 -m http.server 8080 --directory site
# Visit http://localhost:8080

vercel link --project decide-benchmark --scope kodimo --yes
vercel project inspect --non-interactive --scope kodimo
vercel deploy --prod --scope kodimo
```

Use a current Vercel CLI (`npm i -g vercel@latest`). Before deploying, check that
the resolved project and team match those above. Git pushes to `main` should
trigger production deployments once the repository integration is connected.

## Updating paper links and citation

When the paper is public, replace the disabled `Paper / Coming soon` span in
`site/index.html` with a link to the arXiv abstract. Update the provisional BibTeX
in the page and README, and add the identifier. The draft PDF is intentionally
not published by this repository.

## Checks

```bash
python -m unittest discover -s tests -v
python evaluation.py validate --preview
python tools/check_public.py
```

Browser-check each example's audio and reference disclosure, the citation copy
button, keyboard focus, and mobile layout. Run the public-content check again
after staging files and before pushing. Full evaluation downloads and run outputs
belong in ignored directories.
