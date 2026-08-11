# NGIAB frontend

Vanilla JS + native Web Components. No bundler, no build step. Served as-is by Tethys at
`/static/ngiab/frontend/`, entry point `main.js`. Dependencies load from the `esm.sh` CDN at
pinned versions — see `DEPENDENCIES.md` — wired through the import map in
`tethysapp/ngiab/templates/ngiab/index.html`.

**This directory is hand-authored source and is tracked in git.** The legacy React app's
webpack bundle goes to `../react-build/`, which stays gitignored until Phase 2 deletes it.

Run the tests with `npm run test:frontend` (real Chromium via `@web/test-runner`).

## Layout

| File | Responsibility |
|---|---|
| `map.js` | Entry point. Registers the custom elements the template instantiates. |
| `config.js` | Runtime config from `window.__NGIAB__`, injected by the Django template. |
| `api/client.js` | `fetch` wrapper: base URL, JSON, 401 redirect, error normalisation. |
| `api/app.js` | The viewer endpoints, built at call time from `APP_ROOT_URL`. |
| `store/store.js` | ~20-line observable store: `get` / `set` / `subscribe`. |
| `store/app-store.js` | The singleton plus named actions. |
| `lib/ids.js` | Id coercion and search ranking. Pure. |
| `lib/series.js` | Time-series payload → uPlot column arrays. Pure. |
| `lib/metrics.js` | TEEHR metrics payload → table rows. Pure. |
| `lib/choropleth.js` | Bin matrix decoding, frame diffing, colour ramp, legend labels. Pure. |
| `lib/theme.js` | Mirrors the store's theme onto `<html data-theme>`. |
| `lib/errors.js` | The one message a panel may show when a request fails. |
| `lib/pane-resize.js` | Drag, keyboard and collapse for the chart pane. |
| `components/map/layers.js` | Sources, filters, paint expressions, layer specs. Pure. |
| `components/map/interactions.js` | Hover, hit-testing, bounds, tile-derived nexus index. |
| `components/map/choropleth-layer.js` | Applies the value matrix as MapLibre feature-state. |
| `components/map/ngiab-map.js` | The map element: lifecycle, selection, data loading. |
| `components/ngiab-search.js` | Catchment combobox. Emits `catchment-selected`. |
| `components/ngiab-chart.js` | uPlot time-series panel and TEEHR metrics table. |
| `components/ngiab-model-runs.js` | Model-run selector. |
| `components/ngiab-legend.js` | What the catchment colours currently mean. |
| `components/ngiab-timeline.js` | Timestep scrubber and playback. |

The `lib/` and `layers.js` modules take explicit arguments rather than reading module state,
which is what makes them unit-testable without a browser or a live map. That matters: they
are where every subtle bug listed below has lived.

## Architecture

State that crosses component boundaries — selection, theme, layer flags, the derived
troute/teehr ids — lives in the store. Components subscribe in `connectedCallback` and
**must** unsubscribe in `disconnectedCallback`, or every mount leaks a listener.

Tile-derived caches stay local to `<ngiab-map>`: the search index and the catchment → nexus
map churn on every pan, and nothing outside the map reads them. Putting them in the store
would wake every subscriber on every pan.

`<ngiab-search>` knows nothing about MapLibre. It emits a `catchment-selected` CustomEvent
and the map decides what that means, so the two can be reasoned about separately.

## Choropleth and timeline

`getCatchmentValueMatrix` returns one variable's values for every catchment at every timestep,
quantised to class indices and sent as base64 `uint8` — roughly 130 KB for a 55-catchment,
1828-frame run, against about 7 MB for the same numbers as JSON.

**Everything about the matrix is per-run.** Runs differ in which variables they wrote, over
what period, at what step, and across what range of values. The variable list, the time axis,
the class breaks and the decimation step are all derived from the run being asked about, and
none of them may be cached across runs or shared between variables. Selecting a different run
clears the matrix, the timeline and every feature-state.

Breaks are **quantiles over that run's own distribution**, not equal intervals. The data is
heavily zero-weighted and spans orders of magnitude — `Q_OUT` peaks near 1e-4 in the AWI_16
run and could be in the hundreds elsewhere — so a fixed scale puts every catchment in one
class. Breaks are deduplicated, so a variable that is zero most of the time honestly draws
three classes rather than eight, most of them impossible.

Colours are applied with **feature-state**, not by rebuilding a filter or a `match` expression
per frame, and only the catchments whose class actually changed between adjacent frames are
written. Tiles that load later start with no feature-state, so the current frame is reapplied
on `idle`.

Bin `0` means no data and paints transparent. It must never collapse into the lowest class —
that is the `Number(null)` trap one step further downstream.

There are **no units**: nothing in a run's `realization.json` declares them, so the legend
shows the variable name and the numeric breaks and nothing more.

## Source data

Verified against each archive's pmtiles metadata on 2026-08-03:

| Archive | source-layer | zoom | fields (all Number) |
|---|---|---|---|
| `divides.pmtiles` | `divides` | 4–10 | `toid`, `upstream_id`, `num_upstreams` |
| `flowpaths.pmtiles` | `flowpaths` | 1–10 | `divide_id`, `toid`, `upstream_id`, `order`, `num_upstreams` |

`divides` has **no** `divide_id` property. The likely reason is that it was promoted to the
vector-tile feature id — tippecanoe's `--use-attribute-for-id` removes the attribute when it
promotes it — which also explains why `flowpaths` still carries it. Hence `CATCHMENT_KEY` in
`layers.js`. If catchments ever render blank, that constant is the first thing to change; the
click handler logs the raw feature id and properties, so the right value is one click away.

TEEHR results key to USGS gauges, which crosswalk to *nexus* ids — there is no direct
catchment key. Both archives carry `toid`, the downstream nexus, so "drains to a
TEEHR-evaluated nexus" is expressible as a data-driven paint expression: no extra layer, no
extra draw pass.

## Gotchas

Each of these produced a silently wrong result rather than an error.

**`setStyle()` destroys every custom source and layer, and `styledata` is the wrong hook for
putting them back.** Measured on maplibre 4.7.1 after a `setStyle`: `styledata` fires three
times, **every one with `isStyleLoaded()` false**, and never again once the style is ready.
`style.load` is not a public event in this build. So a `styledata` handler guarded on
`isStyleLoaded()` returns early every single time and nothing is ever reinstalled — the map is
permanently empty after a theme toggle. This broke dark mode twice: first by reinstalling too
early on `once('styledata')`, then by adding the `isStyleLoaded()` guard that never passes.

Reinstall from **`idle`**, which does fire with the style loaded. `installLayers` is
idempotent, so calling it on every idle costs a couple of map lookups. Anything that depends on
our sources existing — the nexus reindex, reapplying choropleth feature-state — belongs in the
same handler, after the reinstall.

A screenshot is not a verification of this. Assert on `getSource`, `getLayer` and
`queryRenderedFeatures` before and after the swap; the tests in `layers.test.js` cover the
install-after-wipe contract, and the event timing needs a real browser.

**Layer-scoped listeners live on the map, not the style.** They survive `setStyle()`, so
re-attaching after a swap silently accumulates duplicates. Attach hover once.

**`Number('')` is 0, and so are `Number(null)` and `Number([])`.** Stripping a `cat-` prefix
from an unparseable id leaves `''`, which became catchment 0 — a real feature nobody asked
for. The same trap turned a missing observation into zero flow on a hydrograph.

**An empty id set must match nothing.** A filter that matches everything draws the whole of
CONUS, which is the opposite of an empty run.

**Timestamps arrive in two formats.** `getTrouteTimeSeries` and TEEHR emit
`"2024-01-01 00:00:00"`; a catchment's time column is whatever its CSV or parquet held. A
space-separated timestamp is not valid ISO 8601, so parsing is normalised in `series.js`.

**Series must be unioned on time, not zipped by index.** TEEHR's two series can cover
different spans; zipping plots values at the wrong times instead of showing a gap.

**A run with no catchment outputs renders an empty map**, indistinguishable from a broken one
unless the status line says so out loud.

**`querySourceFeatures` only sees loaded tiles.** A search hit outside them cannot be
located; the highlight filter is applied anyway so it colours in once panned into view.

**TEEHR absence is not knowable client-side.** A missing badge means "no gauge *or* the tile
has not loaded", so the badge is positive-only and there is deliberately no "no TEEHR" marker.

**Model timestamps carry no timezone.** They are model time, so `new Date(stamp)` parses them
as local and `toISOString()` then shifts every frame label by the viewer's offset. A run
stepping at 06:00 displayed as 13:00. `formatFrameTime` reads the string directly and never
constructs a `Date`.

**`tokens.css` keys dark values off `:root[data-theme="dark"]`.** Swapping the MapLibre style
alone left every panel card light-on-dark, because nothing set the attribute. The store's
theme has to be mirrored onto the document — that is all `lib/theme.js` does.

**MapLibre adds no zoom control unless asked.** `NavigationControl` and `ScaleControl` are
opt-in; only `AttributionControl` is on by default. The map had no zoom buttons at all.

**Overlaying the bottom sheet on the map hides MapLibre's own furniture.** The attribution
bar and controls are positioned against the canvas, so a sheet drawn over the canvas covers
them — and the attribution is a licence requirement, not decoration. The narrow-screen rules
shorten `#map` instead, so the canvas ends where the sheet begins.

## Errors

Every failure has two audiences. `ApiError.message` carries the status and the path and goes to
the console; `ApiError.userMessage` is the only thing a panel may show, and it never contains a
status code, a URL or a traceback. Panels read it through `userMessage()` in `lib/errors.js`,
which falls back to a generic sentence for anything that is not an `ApiError` — a non-`ApiError`
reaching a catch block is a programming fault, and its text is not an explanation.

A server `error` string is passed through when it reads like a sentence, because our controllers
write those for the user. It is rejected when it is multi-line, over 200 characters, or contains
a traceback or HTML — with `DEBUG: true` a 500 returns Django's debug page, and a length check
alone would have let a one-line exception repr through.

## Chart pane

Fixed at 300px it took a third of the screen; the fix is not a smaller fixed number but a pane
the user controls. 220px by default, draggable between 120px and 70% of the window, collapsible,
with arrow keys resizing and Enter collapsing. Resizing dispatches `ngiab-pane-resize`, because
MapLibre does not observe container size changes and has to be told to re-measure.

uPlot renders its legend as a sibling of the canvas but sizes only the canvas, so asking for the
container's full height pushes the legend out of sight. The plot takes the height left after it.

The card stack is bounded top and bottom and scrolls inside the map. Unbounded, it grew past the
map pane as cards accumulated and overlapped the chart — which read as the chart being covered.
The graduated legend is a single strip rather than one row per class for the same reason: eight
rows was most of that height.

## UI patterns

The interface was audited against the catalogue at <https://mapuipatterns.com/>. Implemented:
Full map, Search, Info panel, Feature selection, Layer list, Theme toggle, Legend, MapTip,
Zoom control, Choropleth, Timeline slider, Empty state, Home button (zoom to run extent).

Deliberately not implemented: Cluster marker and Heat map (catchments are polygons, not
points), Locate me and Blue dot (the user's position is unrelated to a model run's extent),
Basemap gallery (light and dark are the only two styles published for this hydrofabric).

## Conventions

- ES2023+, ESM only. No `var`, no `require`, no callback-style async.
- Comments are single-line. Anything needing more explanation belongs in this file.
- Components render into **light DOM** so the global stylesheet applies.
