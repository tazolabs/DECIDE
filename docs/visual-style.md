# Website and figure style

DECIDE uses both supplied Tazo Labs Lagoon themes: light paper `#F6F9F9`, ink
`#071416` and teal `#00897B`; dark background `#061214`, foreground `#E6F2F1`
and teal `#19C2AD`. Grays, rules and surface tints derive from these colors.
Thin rules, ridge waveforms and restrained decision highlights carry the brand
into an academic benchmark page.

The header toggle works on the benchmark and evaluation pages. On the first
visit, the theme follows the system preference. An explicit choice is stored
under `decide-theme` in local storage and shared across pages and browser tabs.
`site/theme.js` applies it before styles load to avoid a flash of the wrong theme;
switching still works for the current page when storage is unavailable.

The header Tazo Labs lockup links to the Tazo Labs homepage. Its supplied mark
uses a CSS mask so it follows the active brand color. The partner logo is the
original transparent Bolna PNG provided for the project, preserved without
recoloring or adding a background.

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
- `*-dark.svg`: dark-palette versions of all five figures, selected by the website
  theme, including the mobile layouts and direct figure links.

All figures are under `site/assets/figures/`. The README embeds the same desktop
SVGs, so a regenerated figure updates both surfaces. Text is converted to vector
outlines using the bundled brand fonts, making the images self-contained on GitHub.
The README keeps using the light figures. SVG titles/descriptions, HTML alt text
and the expandable data table provide text
alternatives. No private dataset, row IDs or model predictions are used to build
these figures. Question counts match the existing public README table.

```bash
python -m pip install -r requirements-visuals.txt
python tools/build_benchmark_figures.py
```

The visual overview takes inspiration from the compact benchmark overview and
coverage figures on [MMAU's website](https://mmaubench.github.io/). Its illustrations
and dataset are not copied into DECIDE.
