# Vanilla-JS Migration - Design

**Date:** 2026-07-22
**Status:** Approved (design); implementation plan to follow.

## Goal

Replace the React frontend of the NGIAB visualizer with a **plain-JavaScript** app that is
genuinely simpler and smaller, while preserving the current viewer behavior. This is a
**frontend-only** rewrite: the Tethys/Django backend, its controllers, and the S3 tile/style assets
are reused unchanged.

**DataStream is removed** from the product. The new frontend does not include the S3 forecast
browser/download feature. The existing Django `datastream_*` controllers and `datastream_utils.py`
become dead code, to be deleted as a cutover cleanup item (out of scope for the frontend work).

### Scope reductions decided during implementation (2026-08-10)

These are deliberate product decisions, not gaps to be closed later:

1. **Nexus is removed entirely.** No nexus layer, no clustering, no nexus selection or time series.
   Catchments are the only selectable geometry. The Django `getNexusTimeSeries` controller and the
   `getNexusIDs` / `getNexusList` helpers join the datastream code as dead-on-cutover.

   Consequence worth acting on: `getGeoSpatialData` still builds and serializes the full nexus
   FeatureCollection and calls `append_ngen_usgs_column` + `append_nwm_usgs_column` — **two TEEHR
   warehouse opens per model-run load** — for a payload the frontend now discards. Only `catchments`
   and `bounds` are consumed. `getTeehrLocations` supplies the gauge crosswalk properly.

2. **No toast library.** react-toastify is not replaced by an `ngiab-toast` widget. Status and
   errors go inline: the map panel's status line, and per-section messages next to the thing that
   failed. One less dependency and one less widget to build.

3. **Model-run selection is deferred.** The run comes from `?model_run_id=` in the URL. The React
   run selector and import forms (`getModelRuns`, `importModelRuns`) are not ported yet;
   `viewOnTethys.sh` already handles importing at launch.

## Decisions

| Area | Decision |
|---|---|
| Component model | **Native Web Components** (custom elements), rendered into **light DOM** so one global stylesheet + theming apply everywhere |
| State | **Single global observable store** (~40-line `get`/`set`/`subscribe`, zero deps) with typed action functions; components subscribe to the slices they use |
| Charts | **uPlot** (time-series line charts with built-in cursor/tooltip) |
| UI chrome | **Drop Bootstrap + styled-components.** Minimal custom CSS + hand-built widget elements |
| Build | **No build step.** Native ES modules served directly; dependencies load from a **public CDN** (`esm.sh`) at pinned exact versions, wired via an `importmap`. No Vite / webpack / CRA, no vendored copies. |
| API layer | `services/api` (axios) + `utilities.js` ported **verbatim** (axios from CDN) |
| Scope | Core viewer only: `Map` + `hydroFabric` charts. Single view, no client router beyond a trivial shell |

## Architecture

A single-page app of custom elements mounted in `index.html`, coordinated by one global store,
served by Tethys under `root_url="ngiab"` (unchanged). No bundler: the browser loads `main.js` as a
module and resolves bare imports through an import map pointing at **`esm.sh` CDN URLs at pinned
exact versions**. Nothing is committed to the repo but our own source. The map/tile design is
untouched: MapLibre in the browser, S3-hosted CONUS PMTiles + style JSON, per-run feature IDs from
Django. Only the frontend framework changes.

### Directory structure (replaces `reactapp/`)

Authored at `tethysapp/ngiab/public/frontend/` — served at `/static/ngiab/frontend/`, entry point
`main.js`. That keeps the served URL identical to the React app's, so the Django template's script
path does not change (only its `type="module"` and the added import map do).

That path was also webpack's output path, which is the conflict this resolves: the *React* build moved
instead. `reactapp/config/webpack.config.js` now writes to `public/react-build/` with a matching
`publicPath`, and `.gitignore` ignores `react-build/` while `frontend/` is tracked source. Phase 2
deletes `react-build/` along with `reactapp/`.

```
frontend/
  main.js                 # entry: mount <ngiab-app> into #root
  config.js               # runtime config read from window.__NGIAB__
  DEPENDENCIES.md         # the pinned CDN URL for every dep — the single source of truth
  store/store.js          # createStore: get / set / subscribe (zero deps)
  store/app-store.js      # the singleton + typed mutators: setModelRun, selectFeature,
                          #   setVariable, toggleLayer, setTheme, reset, reset_teehr...
  api/                    # ported verbatim: client.js, app.js, tethys.js, utilities.js
  components/
    ngiab-app.js          # layout shell
    map/ngiab-map.js
    hydrofabric/
      ngiab-chart.js          # uPlot wrapper (catchment / troute / teehr)
      ngiab-layer-control.js
      ngiab-variable-select.js
    widgets/              # ngiab-select, ngiab-modal, ngiab-table, ngiab-switch
  styles/                 # tokens.css (light/dark vars), app.css
  lib/                    # dom.js helpers, time formatting via d3-time-format
```

Flat, with no `src/` level, so the entry stays at `frontend/main.js` — the exact static path the
React bundle occupied.

There is no `index.html` here — Tethys serves the Django template at
`tethysapp/ngiab/templates/ngiab/index.html`, which is where the import map and the module `<script>`
live. No `node_modules` is required to run the app. A minimal `package.json` may still exist for
**dev-only** tooling (test runner, linter); it is never needed to serve the app.

## State & data flow

Store slices:

```js
{
  modelRunId: null,
  selection: { type: null, id: null },   // 'catchment' (nexus was dropped; see Decisions)
  variable: null,
  trouteId: null,
  teehrId: null,
  theme: 'light',                          // 'light' | 'dark'
  layers: { catchmentHidden: false, showTeehr: true },
}
```

`actions.js` exposes functions mirroring today's `hydroFabric` reducer actions
(`set_catchment_id`, `set_troute_id`, `set_teehr_id`, `toggle_*`, `reset`, ...).

Flow:

1. The model run comes from `?model_run_id=` in the URL (a selector is deferred; see Decisions).
2. `ngiab-map` (subscribed to `modelRunId`) fetches `getGeoSpatialData`, fits bounds, renders layers.
3. Map click → `queryRenderedFeatures` → `selectFeature({type,id})` (+ `set_troute_id`, teehr id when present).
4. `ngiab-chart` (subscribed to `selection` + `variable`) fetches the matching time-series endpoint
   (`getCatchmentTimeSeries` / `getTrouteTimeSeries` / `getTeehrTimeSeries`)
   and renders with uPlot.
5. Theme toggle → `setTheme` → map swaps the S3 style URL; charts restyle.

## Components

- **`ngiab-map`** - direct `maplibregl.Map` (drops the `react-map-gl` wrapper), `pmtiles` protocol.
  The `useMemo` layer configs become plain functions returning layer specs; ID-list filtering, hover
  cursor, click hit-test, and highlight-via-`setFilter` port directly. Two geometry-only archives
  (`divides.pmtiles`, `flowpaths.pmtiles`) replace `merged.pmtiles`; catchments and flowlines are
  tinted by TEEHR availability via a data-driven paint expression on `toid`. Delivered.
- **`ngiab-search`** - client-side catchment finder over the run's own id list, replacing the React
  catchment/nexus id dropdowns. Delivered.
- **`ngiab-chart`** - one configurable uPlot element covering all series types; maps the `{x,y}` API
  payloads to uPlot arrays; uses uPlot's built-in cursor/tooltip.
- **`ngiab-layer-control`**, **`ngiab-variable-select`** - toggles and variable picker bound to store.
- **Widgets** - `ngiab-switch`, `ngiab-modal`,
  `ngiab-table` (replaces react-data-table; virtualize only if a list proves large),
  `ngiab-select`.

Each element: subscribes to its store slices in `connectedCallback`, unsubscribes in
`disconnectedCallback`, renders into light DOM.

## Styling & widgets

Drop Bootstrap and styled-components. `tokens.css` holds light/dark CSS variables; `app.css` holds
layout + component styles.

**Open decision:** the searchable/multi-select (`react-select`) is the one widget hard to hand-roll
well. Use native `<select>` where it suffices; for genuinely searchable cases, either build a minimal
`ngiab-select` or add one tiny CDN dependency (Tom Select). To be settled during Phase 1.

## Routing & serving

With DataStream gone there is effectively **one view**, so no real router is needed - `ngiab-app` is
the shell. Tethys `catch_all="home"` continues to serve `index.html`.

No bundler and no manifest: the Django `index.html` template references `frontend/main.js` as a module
and declares the import map, whose entries are absolute `esm.sh` URLs. The one integration detail is
the **static base URL** under Tethys (the page is served at `/apps/ngiab/`, our files at
`/static/ngiab/frontend/`), so every `{% static %}` URL must be absolute — a relative module specifier
would resolve against `/apps/ngiab/` and 404. Runtime config replaces the old build-time
`TETHYS_APP_ROOT_URL` env var: the template injects `window.__NGIAB__`.

Because the entry path is unchanged from the React app's, the cutover is a one-line change in the
template — `type="module"` plus the import map — rather than a new URL to wire up.

## Testing

`@web/test-runner` (runs native ESM in a real browser - no bundler, ideal for Web Components):

- Unit: `store`/`actions` (pure) and the api layer (mock axios).
- Component: mount an element → dispatch an action → assert DOM.
- Map/uPlot: smoke coverage; optional Playwright for the map interaction path.

Replaces jest + testing-library/react. (Node's built-in `node:test` + jsdom is a fallback for the
non-DOM units.) The test runner is a dev-only dependency and does not affect how the app is served.

## Phasing

- **Phase 0 - scaffold:** template + import map (CDN) + runtime config + store + api port + `ngiab-app`
  shell + Tethys static/template wiring + one trivial element rendering. Proves the (build-less)
  pipeline end-to-end.
- **Phase 1 - core viewer:** `ngiab-map`, `ngiab-chart`, layer/variable controls,
  full linked selection and theming. Ship & validate.
- **Phase 2 - cutover:** delete `reactapp/`, the React/webpack toolchain (package.json build deps,
  webpack + babel config), and the `public/react-build/` output dir plus its `.gitignore` entry;
  delete the now-unused Django `datastream_*` controllers and `datastream_utils.py`. The template
  already serves the vanilla frontend from Phase 0 Task 11, so no serving change is needed here.

## Risks / open items

- Searchable-select replacement (native `<select>` vs hand-rolled `ngiab-select` vs Tom Select from
  the CDN) - decide in Phase 1 against a real model-run list.
- Static base URL under Tethys for module + import-map resolution - proven in Phase 0 before feature work.
- **CDN delivery is an accepted tradeoff, not a risk to mitigate.** Dependencies come from `esm.sh` at
  runtime, so the app requires internet access to load. This does not regress anything real: the
  basemap style JSON and `merged.pmtiles` were already fetched from S3 at runtime (`mapgl.js`), so the
  viewer never worked air-gapped. If true air-gapped operation is ever required it is one project —
  localize tiles/styles **and** vendor the JS together — and out of scope here.
- CDN specifics: pin **exact** versions (`esm.sh/axios@0.30.2`, never `@latest` or a range) so a
  publish upstream cannot change behavior under us. Record every URL in `frontend/DEPENDENCIES.md`.
  Accept the residual exposure: an `esm.sh` outage takes the app down, and a compromised CDN would
  serve arbitrary JS. If that becomes unacceptable, the mitigation is a CSP `script-src` allowlist
  plus import-map `integrity` hashes, or reverting to vendored copies.
- No minification/tree-shaking on our own source → larger transferred JS (CDN deps do arrive
  minified). Acceptable for the local/single-container use case; if a bandwidth-sensitive hosted
  deploy ever needs it, add an optional one-shot minify step (the only reason to reintroduce a build).
- Import maps require modern evergreen browsers (Chrome/Edge/Firefox, Safari 16.4+) - already implied
  by MapLibre's WebGL2 requirement.
- Whether any table/list needs virtualization - assess against real data in Phase 1.
- Light-DOM theming (chosen over shadow DOM) - keeps global CSS simple; document the convention.
- Behavior parity: preserve current viewer behavior; drop dead/commented code as encountered.
