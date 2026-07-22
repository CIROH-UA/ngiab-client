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

## Decisions

| Area | Decision |
|---|---|
| Component model | **Native Web Components** (custom elements), rendered into **light DOM** so one global stylesheet + theming apply everywhere |
| State | **Single global observable store** (~40-line `get`/`set`/`subscribe`, zero deps) with typed action functions; components subscribe to the slices they use |
| Charts | **uPlot** (time-series line charts with built-in cursor/tooltip) |
| UI chrome | **Drop Bootstrap + styled-components.** Minimal custom CSS + hand-built widget elements |
| Build | **No build step.** Native ES modules served directly, dependencies vendored as local ESM and wired via an `importmap`. No Vite / webpack / CRA. |
| API layer | `services/api` (axios) + `utilities.js` ported **verbatim** (axios also vendored as ESM) |
| Scope | Core viewer only: `Map`, `ModelRuns`, `hydroFabric`. Single view, no client router beyond a trivial shell |

## Architecture

A single-page app of custom elements mounted in `index.html`, coordinated by one global store,
served by Tethys under `root_url="ngiab"` (unchanged). No bundler: the browser loads `main.js` as a
module and resolves bare imports through an import map that points at vendored, local ESM builds
(kept in-repo so the app stays fully offline in the single-container/local deployment). The map/tile
design is untouched: MapLibre in the browser, S3-hosted CONUS PMTiles + style JSON, per-run feature
IDs from Django. Only the frontend framework changes.

### Directory structure (replaces `reactapp/`)

```
frontend/
  index.html              # <script type="importmap"> + <script type="module" src="src/main.js">
  vendor/                 # committed ESM builds + their CSS: maplibre-gl, uplot, pmtiles,
                          #   d3-array, d3-scale, d3-time-format, axios
  src/
    main.js               # build store, mount <ngiab-app>
    store/store.js        # createStore: get / set / subscribe (zero deps)
    store/actions.js      # typed mutators: setModelRun, selectFeature, setVariable,
                          #   toggleLayer, setTheme, reset, reset_teehr, reset_troute...
    api/                  # ported verbatim: client.js, app.js, tethys.js, utilities.js
    components/
      ngiab-app.js        # layout shell
      map/ngiab-map.js
      model-runs/ngiab-model-runs.js
      hydrofabric/
        ngiab-chart.js        # uPlot wrapper (nexus / catchment / troute / teehr)
        ngiab-layer-control.js
        ngiab-variable-select.js
      widgets/            # ngiab-select, ngiab-toast, ngiab-modal, ngiab-table, ngiab-switch
    styles/               # tokens.css (light/dark vars), app.css
    lib/                  # dom.js helpers, time formatting via d3-time-format
```

No `node_modules` is required to run the app. A minimal `package.json` may still exist for **dev-only**
tooling (test runner, linter); it is never needed to serve the app.

## State & data flow

Store slices:

```js
{
  modelRunId: null,
  selection: { type: null, id: null },   // 'nexus' | 'catchment'
  variable: null,
  trouteId: null,
  teehrId: null,
  theme: 'light',                          // 'light' | 'dark'
  layers: { nexusHidden: false, nexusClustered: false, catchmentHidden: false },
}
```

`actions.js` exposes functions mirroring today's `hydroFabric` / `ModelRuns` reducer actions
(`set_nexus_id`, `set_catchment_id`, `toggle_*`, `reset`, ...) so the port is close to 1:1 in behavior.

Flow:

1. `ngiab-model-runs` loads runs (`getModelRuns`); selecting one calls `setModelRun(id)`.
2. `ngiab-map` (subscribed to `modelRunId`) fetches `getGeoSpatialData`, fits bounds, renders layers.
3. Map click → `queryRenderedFeatures` → `selectFeature({type,id})` (+ `set_troute_id`, teehr id when present).
4. `ngiab-chart` (subscribed to `selection` + `variable`) fetches the matching time-series endpoint
   (`getNexusTimeSeries` / `getCatchmentTimeSeries` / `getTrouteTimeSeries` / `getTeehrTimeSeries`)
   and renders with uPlot.
5. Theme toggle → `setTheme` → map swaps the S3 style URL; charts restyle.

## Components

- **`ngiab-map`** - direct `maplibregl.Map` (drops the `react-map-gl` wrapper), `pmtiles` protocol,
  S3 styles/tiles unchanged. The current `useMemo` layer configs (`mapgl.js`) become plain functions
  returning layer specs; ID-list filtering, nexus clustering (geojson `cluster:true`), hover cursor,
  click hit-test, and highlight-via-`setFilter` port directly. Dead/commented code is dropped.
- **`ngiab-model-runs`** - run selector; writes `modelRunId`.
- **`ngiab-chart`** - one configurable uPlot element covering all series types; maps the `{x,y}` API
  payloads to uPlot arrays; uses uPlot's built-in cursor/tooltip.
- **`ngiab-layer-control`**, **`ngiab-variable-select`** - toggles and variable picker bound to store.
- **Widgets** - `ngiab-switch`, `ngiab-modal`, `ngiab-toast` (replaces react-toastify),
  `ngiab-table` (replaces react-data-table; virtualize only if a list proves large),
  `ngiab-select`.

Each element: subscribes to its store slices in `connectedCallback`, unsubscribes in
`disconnectedCallback`, renders into light DOM.

## Styling & widgets

Drop Bootstrap and styled-components. `tokens.css` holds light/dark CSS variables; `app.css` holds
layout + component styles.

**Open decision:** the searchable/multi-select (`react-select`) is the one widget hard to hand-roll
well. Use native `<select>` where it suffices; for genuinely searchable cases, either build a minimal
`ngiab-select` or vendor one tiny ESM dependency (Tom Select). To be settled during Phase 1.

## Routing & serving

With DataStream gone there is effectively **one view**, so no real router is needed - `ngiab-app` is
the shell. Tethys `catch_all="home"` continues to serve `index.html`.

No bundler and no manifest: the Django `index.html` template references `src/main.js` as a module and
declares the import map. Vendored ESM under `vendor/` is served as static files. The one integration
detail is the **static base URL** under Tethys (the app is served under `/apps/ngiab/…`), so the
import map and module `src` must resolve against the correct base - injected once into the template
alongside the existing `TETHYS_APP_ROOT_URL`.

## Testing

`@web/test-runner` (runs native ESM in a real browser - no bundler, ideal for Web Components):

- Unit: `store`/`actions` (pure) and the api layer (mock axios).
- Component: mount an element → dispatch an action → assert DOM.
- Map/uPlot: smoke coverage; optional Playwright for the map interaction path.

Replaces jest + testing-library/react. (Node's built-in `node:test` + jsdom is a fallback for the
non-DOM units.) The test runner is a dev-only dependency and does not affect how the app is served.

## Phasing

- **Phase 0 - scaffold:** `index.html` + import map + vendored ESM + store + api port + `ngiab-app`
  shell + Tethys static/template wiring + one trivial element rendering. Proves the (build-less)
  pipeline end-to-end.
- **Phase 1 - core viewer:** `ngiab-map`, `ngiab-model-runs`, `ngiab-chart`, layer/variable controls,
  full linked selection and theming. Ship & validate.
- **Phase 2 - cutover:** switch Tethys to serve the vanilla `frontend/`; delete `reactapp/` and the
  React/CRA toolchain (package.json build deps, config); delete the now-unused Django `datastream_*`
  controllers and `datastream_utils.py`.

## Risks / open items

- Searchable-select replacement (native vs minimal build vs vendored Tom Select) - decide in Phase 1.
- Static base URL under Tethys for module + import-map resolution - proven in Phase 0 before feature work.
- Vendored ESM deps are updated manually (no npm-driven bumps); record versions in `vendor/`.
- No minification/tree-shaking → larger transferred JS. Acceptable for the local/single-container use
  case; if a bandwidth-sensitive hosted deploy ever needs it, add an optional one-shot minify step
  (the only reason to reintroduce a build).
- Import maps require modern evergreen browsers (Chrome/Edge/Firefox, Safari 16.4+) - already implied
  by MapLibre's WebGL2 requirement.
- Whether any table/list needs virtualization - assess against real data in Phase 1.
- Light-DOM theming (chosen over shadow DOM) - keeps global CSS simple; document the convention.
- Behavior parity: preserve current viewer behavior; drop dead/commented code as encountered.
