# Website and figure style

DECIDE uses the supplied Tazo Labs light theme, Lagoon: paper `#F6F9F9`, ink
`#071416`, teal `#00897B`, and derived ink/teal tints. Small text uses darker
brand-derived tones for contrast. Thin rules, ridge waveforms and restrained
decision highlights carry the brand into an academic benchmark page.

Hanken Grotesk is the display face, Inter the body face, and IBM Plex Mono the
technical label/code face. Latin WOFF2 files are self-hosted in `site/assets/fonts/`;
no external font service runs in the browser. They come from Fontsource 5.3.0;
each font's OFL license is included alongside it. Logo marks and the favicon are
copied from the supplied Tazo brand kit.

## Shared website and README figures

- `benchmark-overview.svg`: schematic call-to-decision overview and six task families.
- `decision-families.svg`: the published v1.0 aggregate question counts.
- `*-mobile.svg`: stacked layouts used by the website below 640px.
- `ridge.svg`: decorative ridge artwork, not an acoustic measurement.

All figures are under `site/assets/figures/`. The README embeds the same desktop
SVGs, so a regenerated figure updates both surfaces. Text is converted to vector
outlines using the bundled brand fonts, making the images self-contained on GitHub.
SVG titles/descriptions, HTML alt text and the expandable data table provide text
alternatives. No private dataset, row IDs or model predictions are used to build
these figures. Question counts match the existing public README table.

```bash
python -m pip install -r requirements-visuals.txt
python tools/build_benchmark_figures.py
```

The visual overview takes inspiration from the compact benchmark overview and
coverage figures on [MMAU's website](https://mmaubench.github.io/). Its illustrations
and dataset are not copied into DECIDE.
