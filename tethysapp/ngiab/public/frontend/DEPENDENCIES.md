# Frontend dependencies (CDN, no bundler)

The browser loads these directly. The authoritative wiring is the `<script type="importmap">`
block in `tethysapp/ngiab/templates/ngiab/index.html` -- **this file and that import map must
agree.**

Rules:
- Pin **exact** versions. Never `@latest`, never a range: an upstream publish must not be able
  to change our behaviour.
- One entry per *direct* dependency. `esm.sh` rewrites transitive imports to origin-rooted
  URLs, so transitive deps need no entry.
- Bumping a version = edit here, edit the import map, reload, verify. Commit both together.

## In use

| Package | Version | Import-map URL |
|---|---|---|
| maplibre-gl | 4.7.1 | `https://esm.sh/maplibre-gl@4.7.1` |
| pmtiles | 3.2.1 | `https://esm.sh/pmtiles@3.2.1` |
| uplot | 1.6.32 | `https://esm.sh/uplot@1.6.32` |

### Stylesheets (plain `<link>`, not import-map entries)

| Package | URL |
|---|---|
| maplibre-gl | `https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css` |
| uplot | `https://cdn.jsdelivr.net/npm/uplot@1.6.32/dist/uPlot.min.css` |

## Deliberately absent

- **axios** -- the API layer uses native `fetch`. Everything the React client used axios for
  (base URL, JSON headers, unwrapping, the 401 redirect) is a few lines in `api/client.js`.
- **a toast library** -- status and errors render inline next to what failed.
- **d3-array / d3-scale / d3-time-format** -- uPlot handles its own scales and time axis.

## Accepted tradeoff

CDN delivery means the app needs internet access to load. This regresses nothing: the basemap
style and `pmtiles` archives were already fetched from S3 at runtime, so the viewer never
worked air-gapped.
