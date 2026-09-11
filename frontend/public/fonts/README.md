# The two typefaces

Both under the SIL Open Font License 1.1, whose text ships beside them —
that is a condition of redistributing them, which is what serving them
from this origin is.

| File | Family | Taken from |
| --- | --- | --- |
| `inter-latin-variable.woff2` | Inter Variable, weights 100–900 | `@fontsource-variable/inter`, `files/inter-latin-wght-normal.woff2` |
| `instrument-serif-latin-400.woff2` | Instrument Serif, 400 only | `@fontsource/instrument-serif`, `files/instrument-serif-latin-400-normal.woff2` |

Copied by hand rather than imported as packages. The package entry points
declare every subset — Cyrillic, Greek, Vietnamese, Latin Extended — and
the service worker precaches every `woff2` it can find, which would mean a
quarter of a megabyte fetched before first paint for alphabets this app
never renders. The Latin subset covers Italian and English; Japanese names
fall through to the system font, since neither face has those glyphs.

The `@font-face` rules, including Inter's `unicode-range`, live at the top
of `src/index.css`. To update:

```sh
npm install --no-save @fontsource-variable/inter @fontsource/instrument-serif
cp node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2 \
   public/fonts/inter-latin-variable.woff2
cp node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2 \
   public/fonts/instrument-serif-latin-400.woff2
cp node_modules/@fontsource-variable/inter/LICENSE public/fonts/Inter-OFL.txt
cp node_modules/@fontsource/instrument-serif/LICENSE public/fonts/InstrumentSerif-OFL.txt
npm uninstall @fontsource-variable/inter @fontsource/instrument-serif
```

Then check `unicode-range` against the package's `wght.css` — if upstream
changes the subset boundaries, a stale range silently stops the font from
being used for the characters it dropped.
