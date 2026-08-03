# Map Spike — Port `mapgl.js` to Vanilla MapLibre

> **Audience: a human implementer.** Complete code, exact commands, expected output.
> **No new route.** `map.html` is a Django partial `{% include %}`d into the home template
> (`templates/ngiab/index.html`, served by the `home` controller). The map renders at
> `/apps/ngiab/`.
> **Self-contained JS.** `map.js` uses plain `fetch` and module-local state, so it depends on nothing
> from the Phase 0 scaffold and folds into `<ngiab-map>` later.

> **⚠ This replaces the React home page.** `index.html` currently loads `react-build/main.js`.
> Adding the map means removing that script — you cannot have React mounting `#root` and the vanilla
> map on the same page. So this task list subsumes **Phase 0 Task 11** (the template cutover) and
> **Task 10** (passing `app_root_url` into the context). `git revert` is the way back.

**Goal:** prove that `reactapp/features/Map/components/mapgl.js` (429 lines, `react-map-gl` +
`@visx`-era React) reproduces in plain MapLibre with no bundler — full behavior parity: pmtiles
basemap, catchment/flowpath/gauge layers filtered by model-run IDs, nexus points with clustering,
click-to-select with highlight, hover cursor, theme swap, `fitBounds`.

**Why spike this first:** it is the only part of the migration with real uncertainty. The store, API
port, and Web Component plumbing are mechanical; `react-map-gl` was doing four non-obvious things for
us that vanilla MapLibre does not. Find that out on a throwaway page, not inside Phase 1.

**Success:** `/apps/ngiab/` shows the CONUS basemap, a selected model run's catchments and nexus
points, clicking a nexus turns it red and logs its ID, clicking a cluster zooms in, and the
light/dark and cluster/uncluster toggles both work without losing layers.

---

## What `react-map-gl` was hiding

Four things the React version got for free. Each is a real defect if ported literally.

### 1. `source: 'hydrofabric'` is a lie — the real source id is `conus`

Every layer config in `mapgl.js` says `source: 'hydrofabric'`, but they are children of
`<Source id="conus">`, and `react-map-gl` **overwrites** the prop:

```js
// node_modules/react-map-gl/dist/esm/components/source.js:111-114
React.Children.map(props.children, child => child &&
  cloneElement(child, {
    source: id          // <- clobbers whatever the layer declared
  }))
```

So at runtime those layers bind to `conus`. There is no source named `hydrofabric` anywhere in the
app. Copy the string literally into `map.addLayer()` and MapLibre throws
`Error: Source "hydrofabric" not found`. **Use `conus` everywhere.**

### 2. `setStyle()` destroys every custom source and layer

This is the structural difference, and the one that will waste your afternoon if you don't plan for
it. The React version swaps basemaps by changing a prop:

```js
const mapStyleUrl = theme === 'dark' ? '…/dark-style.json' : '…/light-style.json';
return <Map mapStyle={mapStyleUrl}> …declarative <Source>/<Layer> children… </Map>
```

React re-runs the render and re-declares the children, so `react-map-gl` re-adds them onto the new
style. Vanilla `map.setStyle(url)` replaces the entire style document — your `conus` source,
`nexus-points` source, and all nine layers are simply gone.

**The fix that shapes the whole file:** all source/layer creation lives in one idempotent
`installLayers(map)` function, called on initial load *and* after every style swap. Idempotent
matters because `styledata` fires more than once per style change — guard every add with a
`map.getSource(...)` / `map.getLayer(...)` check and re-installation becomes safe to call whenever.

### 3. Clustering can't be toggled — the source must be rebuilt

`cluster` is a GeoJSON-source *construction* option, not a settable property. React remounted the
source with a changed `key`:

```js
<Source key={`nexus-source-${isClustered}`} cluster={isClustered} …>
```

In vanilla: remove the five nexus layers, remove the source, re-add with the new `cluster` value,
re-add the layers. Layers must come off before the source or MapLibre errors on the dangling
reference.

### 4. `addSource` rejects `data: null`

React passes `data={nexusPoints}` while `nexusPoints` is still `null` on first render and
`react-map-gl` tolerates it. `map.addSource()` does not. Seed with an empty
`FeatureCollection` so layers can exist before the fetch resolves, then `setData()` when it lands.

### Also worth knowing

- **`maplibregl.addProtocol('pmtiles', …)` is global, not per-map.** The React version registers it
  inside the data-fetching `useEffect` and `removeProtocol`s on cleanup — so it re-registers on every
  theme change and model-run change. Register once at module scope.
- **`getGeoSpatialData` reports failure with HTTP 200.** The controller returns
  `JsonResponse({"error": "…"})` (`controllers.py:173`), so you must check `body.error`, not
  `response.ok`.
- **`bounds` is a flat 4-array** — `gdf.total_bounds.tolist()` → `[west, south, east, north]`, which
  `fitBounds` accepts directly.
- **`getClusterExpansionZoom` returns a Promise** in MapLibre GL JS v4 — the React code already
  `await`s it, so keep the `await`.
- **A latent bug, preserved deliberately.** In the nexus-click branch the comment says "ensure
  catchments remain hidden" but the call is `show_nexus_geometry()`; the catchment branch is the
  mirror image. It looks wrong, but this spike reproduces current behavior rather than fixing it.
  Decide what it *should* do when `<ngiab-map>` is built for real.

---

## Task overview

| # | Task | Files | Verify |
|---|---|---|---|
| 1 | Clean up leftovers | `public/frontend/src/` | `find` |
| 2 | The `map.html` partial | `templates/ngiab/map.html` | — |
| 3 | Include it in the home template | `templates/ngiab/index.html`, `controllers.py` | curl for importmap |
| 4 | Constants and layer specs | `public/frontend/map.js` | — |
| 5 | `installLayers` + interactions | `public/frontend/map.js` | — |
| 6 | Data fetch and boot | `public/frontend/map.js` | browser |
| 7 | Verify parity against React | — | manual checklist |

**How the two templates split responsibility.** A Django `{% include %}` inlines the partial's text
into the parent, so the document-level concerns must live in the parent and only the parent:

| Concern | Lives in | Why |
|---|---|---|
| `window.__NGIAB__` config | `index.html` `<head>` | Must run before any module |
| Import map | `index.html` `<head>` | One per document, must precede the first module script |
| MapLibre + app stylesheets | `index.html` `<head>` | Document-level `<link>`s |
| Map markup, panel, scoped CSS | `map.html` | The reusable piece |
| `<script type="module" src="map.js">` | `map.html` | Keeps the partial one-line includable |

The module script can sit inside the partial because the include renders it into `<body>`, after the
parent's `<head>` import map — which is the only ordering rule that matters.

---

### Task 1: Clean up leftovers from the directory move

Two empty dirs survived the `public/app/` → `public/frontend/` move, and `main.js` is an empty
placeholder that would shadow the real Phase 0 entry.

- [ ] **Step 1: Remove the empty dirs**

```bash
find tethysapp/ngiab/public/frontend/src -type d -empty -delete
find tethysapp/ngiab/public/frontend -type f | sort
```

Expected afterwards — exactly:

```
tethysapp/ngiab/public/frontend/README.md
tethysapp/ngiab/public/frontend/main.js
tethysapp/ngiab/public/frontend/map.js
tethysapp/ngiab/public/frontend/styles/app.css
tethysapp/ngiab/public/frontend/styles/tokens.css
```

- [ ] **Step 2: Leave `main.js` empty**

It stays a zero-byte placeholder until Phase 0 Task 9. This spike does not use it — `map.html` loads
`map.js` directly. Nothing imports `main.js`, so an empty file is harmless.

---

### Task 2: The `map.html` partial

**Files:** `tethysapp/ngiab/templates/ngiab/map.html` (currently empty)

A **fragment**, not a document — no `<!DOCTYPE>`, `<html>`, `<head>`, or `<body>`. Django's
`{% include %}` inlines this text verbatim into the parent, so any of those tags would produce
invalid nested markup.

It does need its own `{% load static tethys %}`: **template tag loads do not inherit across an
include.** Omit it and `{% static tethys_app|public:'…' %}` fails or renders empty.

- [ ] **Step 1: Write the partial**

`tethysapp/ngiab/templates/ngiab/map.html`:

```html
{% load static tethys %}

<style>
  #map { position: absolute; inset: 0; }
  #map-panel {
    position: absolute; z-index: 1; top: 10px; left: 10px;
    background: rgba(255, 255, 255, .92); padding: 10px 12px; border-radius: 6px;
    font: 13px/1.5 system-ui, sans-serif; box-shadow: 0 1px 4px rgba(0, 0, 0, .3);
  }
  #map-panel label { display: block; }
  #map-status { margin-top: 6px; color: #555; max-width: 260px; }
</style>

<div id="map-panel">
  <label><input type="checkbox" id="toggle-theme" /> dark basemap</label>
  <label><input type="checkbox" id="toggle-catchments" /> hide catchments</label>
  <div id="map-status">loading…</div>
</div>
<div id="map"></div>

<script type="module" src="{% static tethys_app|public:'frontend/map.js' %}"></script>
```

The two checkboxes exist so you can exercise the paths that would otherwise go untested — the theme
swap in particular is what breaks if `installLayers` isn't idempotent.

> **Scope change (2026-08-03):** the nexus layers are gone, and so are the cluster/hide-nexus
> toggles that drove them. `merged.pmtiles` is replaced by two geometry-only archives —
> `divides.pmtiles` for catchments and `flowpaths.pmtiles` for lines, both under
> `map/only_geometry/upstream_index/`. Tasks 4–6 below still describe the earlier nexus-bearing
> version; `public/frontend/map.js` is the current source of truth.

`#map` is absolutely positioned to fill its containing block, so whatever wrapper the parent puts it
in needs `position: relative` and a real height — Task 3 handles that.

- [ ] **Step 2: Commit**

```bash
git add tethysapp/ngiab/templates/ngiab/map.html
git commit -m "feat: map.html partial with the map container and dev toggles"
```

---

### Task 3: Include the partial in the home template

**Files:**
- Modify: `tethysapp/ngiab/templates/ngiab/index.html` (full replace)
- Modify: `tethysapp/ngiab/controllers.py` — the `home` controller (~line 84)

The parent owns everything document-level: the config script, the import map, and the stylesheets.
Same three ordering rules as Phase 0 Task 11 — **import map before the first module script, exactly
one per document, absolute `{% static %}` URLs** (the page is at `/apps/ngiab/`, the files at
`/static/ngiab/frontend/`, so a relative specifier 404s).

Both CDN URLs were verified reachable 2026-08-03.

- [ ] **Step 1: Pass `app_root_url` into the context**

This is Phase 0 Task 10. `App.root_url` is `"ngiab"` (`app.py:15`), so this renders `/apps/ngiab/` —
the same value the old build-time `TETHYS_APP_ROOT_URL` held.

```python
@controller
def home(request):
    """Controller for the app home page."""
    # index.html loads the build-less vanilla frontend and injects runtime config
    # into window.__NGIAB__.
    context = {"app_root_url": f"/apps/{App.root_url}/"}
    return App.render(request, "index.html", context)
```

`App` is already imported.

- [ ] **Step 2: Replace the home template**

`tethysapp/ngiab/templates/ngiab/index.html`:

```html
{% load static tethys %}
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#2c3e50" />
    <link rel="shortcut icon" href="{% if site_globals.favicon and 'http' in site_globals.favicon %}{{ site_globals.favicon }}{% elif site_globals.favicon %}{% static site_globals.favicon %}{% else %}{% static 'tethys_portal/images/default_favicon.png' %}{% endif %}" />
    <title>{{ tethys_app.name }}</title>

    <!-- Runtime config. Classic inline script, so it runs before the deferred modules below. -->
    <script>
      window.__NGIAB__ = {
        APP_ROOT_URL: "{{ app_root_url|escapejs }}",
        PORTAL_HOST: "",
        // Default model run. Override per-request with ?model_run_id=… in the URL.
        MODEL_RUN_ID: ""
      };
    </script>

    <!-- Import map for bare specifiers. MUST precede any module script, and there can be
         only one per document. Versions pinned in public/frontend/DEPENDENCIES.md. -->
    <script type="importmap">
    {
      "imports": {
        "maplibre-gl": "https://esm.sh/maplibre-gl@4.7.1",
        "pmtiles": "https://esm.sh/pmtiles@3.2.1"
      }
    }
    </script>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
    <link rel="stylesheet" href="{% static tethys_app|public:'frontend/styles/tokens.css' %}" />
    <link rel="stylesheet" href="{% static tethys_app|public:'frontend/styles/app.css' %}" />
    <style>
      html, body { height: 100%; margin: 0; }
      /* #map is absolutely positioned, so its container needs a positioning context. */
      #root { position: relative; height: 100%; }
    </style>
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root">
      {% include "ngiab/map.html" %}
    </div>
  </body>
</html>
```

The React `<script src="…react-build/main.js">` is **gone** — that is the cutover. `#root` is kept as
the mount point so Phase 0's `main.js` can take over later without another template change.

Note there is no `main.js` script tag yet: `map.js` comes in via the partial. When Phase 0 lands,
`main.js` becomes the single entry and the partial's script tag goes away in favor of `<ngiab-map>`.

- [ ] **Step 3: Verify the render**

With the server running (`tethys manage start`):

```bash
curl -s http://localhost:8000/apps/ngiab/ | grep -E 'importmap|esm.sh|frontend/map.js|__NGIAB__|id="map"'
```

Expected, all present:
- `window.__NGIAB__ = {` with `APP_ROOT_URL: "/apps/ngiab/"`
- the import map with both `esm.sh` URLs
- `<div id="map"></div>` — proof the include resolved
- `<script type="module" src="/static/ngiab/frontend/map.js">`

Then confirm the static file is actually served:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/static/ngiab/frontend/map.js
```

Expected `200`. If it 404s, run `tethys manage collectstatic` — this directory did not exist when
statics were last collected.

- [ ] **Step 4: Commit**

```bash
git add tethysapp/ngiab/templates/ngiab/index.html tethysapp/ngiab/controllers.py
git commit -m "feat: serve the vanilla map from the home template via include"
```

**If the include fails:**

| Symptom | Cause | Fix |
|---|---|---|
| `TemplateDoesNotExist: ngiab/map.html` | Wrong include path | It is app-namespaced — `{% include "ngiab/map.html" %}`, not `"map.html"` |
| Empty `src=""` on the module script | `{% load static tethys %}` missing from the **partial** | Loads do not inherit across an include; the partial needs its own |
| Map div present but zero height | `#root` has no height or no `position: relative` | Both are in the Step 2 `<style>` block |
| Page still renders React | Stale collected template | `tethys manage collectstatic`, then hard-reload |

---

### Task 4: `map.js` part 1 — constants, state, layer specs

The `useMemo` layer configs become plain functions of module state. Same output, no dependency arrays.

**Files:** `tethysapp/ngiab/public/frontend/map.js`

- [ ] **Step 1: Write the top of the file**

```js
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

// ---------------------------------------------------------------------------
// Constants — lifted verbatim from reactapp/features/Map/components/mapgl.js
// ---------------------------------------------------------------------------
const STYLE_URLS = {
  light: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/light-style.json',
  dark: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json',
};
const PMTILES_URL =
  'pmtiles://https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/merged.pmtiles';

// The vector source id. NOTE: the React layer configs say source:'hydrofabric', but
// react-map-gl overwrites that with the parent <Source id="conus">. 'conus' is the real id.
const SRC_CONUS = 'conus';
const SRC_NEXUS = 'nexus-points';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// Every layer this module owns, in the paint order they must be added.
const CONUS_LAYERS = ['catchments-layer', 'flowpaths-layer', 'gauges-layer', 'catchment-highlight'];
const NEXUS_LAYERS = ['all-points', 'clusters', 'cluster-count', 'unclustered-point', 'nexus-highlight'];

// ---------------------------------------------------------------------------
// State — becomes the global store when this turns into <ngiab-map>
// ---------------------------------------------------------------------------
const state = {
  theme: 'light',
  clustered: false,
  nexusHidden: false,
  catchmentHidden: false,
  selectedNexusId: null,
  selectedCatchmentId: null,
  nexusPoints: EMPTY_FC,
  catchmentIds: [],
  flowPathIds: [],
  nexusIds: [],
};

const isDark = () => state.theme === 'dark';

// Register the pmtiles protocol once, at module scope. The React version did this inside a
// useEffect keyed on [theme, base_model_id], so it re-registered on every change.
maplibregl.addProtocol('pmtiles', new Protocol({ metadata: true }).tile);

// ---------------------------------------------------------------------------
// Layer specs — the useMemo blocks, as plain functions
// ---------------------------------------------------------------------------

// Legacy 'in' filter, matching the React version. An empty id list must still produce a
// valid filter that matches nothing, or the layer would show all of CONUS.
const inFilter = (key, ids) =>
  ids && ids.length ? ['any', ['in', key, ...ids]] : ['any', ['in', key, '']];

const visibility = (hidden) => ({ visibility: hidden ? 'none' : 'visible' });

function catchmentsSpec() {
  return {
    id: 'catchments-layer',
    type: 'fill',
    source: SRC_CONUS,
    'source-layer': 'conus_divides',
    filter: inFilter('divide_id', state.catchmentIds),
    paint: {
      'fill-color': isDark() ? 'rgba(238, 51, 119, 0.316)' : 'rgba(91, 44, 111, 0.316)',
      'fill-outline-color': isDark() ? 'rgba(238, 51, 119, 0.7)' : 'rgba(91, 44, 111, 0.7)',
      'fill-opacity': { stops: [[7, 0], [11, 1]] },
    },
    layout: visibility(state.catchmentHidden),
  };
}

function flowPathsSpec() {
  return {
    id: 'flowpaths-layer',
    type: 'line',
    source: SRC_CONUS,
    'source-layer': 'conus_flowpaths',
    filter: inFilter('id', state.flowPathIds),
    paint: {
      'line-color': isDark() ? '#0077bb' : '#000000',
      'line-width': { stops: [[7, 1], [10, 2]] },
      'line-opacity': { stops: [[7, 0], [11, 1]] },
    },
  };
}

function gaugesSpec() {
  return {
    id: 'gauges-layer',
    type: 'circle',
    source: SRC_CONUS,
    'source-layer': 'conus_gages',
    filter: inFilter('nex_id', state.nexusIds),
    paint: {
      'circle-radius': { stops: [[3, 2], [11, 5]] },
      'circle-color': isDark() ? '#c8c8c8' : '#646464',
      'circle-opacity': { stops: [[3, 0], [9, 1]] },
    },
  };
}

function catchmentHighlightSpec() {
  return {
    id: 'catchment-highlight',
    type: 'fill',
    source: SRC_CONUS,
    'source-layer': 'conus_divides',
    filter: ['==', ['get', 'divide_id'], state.selectedCatchmentId ?? ''],
    paint: {
      'fill-color': '#ff0000',
      'fill-outline-color': '#ffffff',
      'fill-opacity': 0.5,
    },
    layout: visibility(state.catchmentHidden),
  };
}

function nexusHighlightSpec() {
  return {
    id: 'nexus-highlight',
    type: 'circle',
    source: SRC_NEXUS,
    filter: state.selectedNexusId
      ? ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], state.selectedNexusId]]
      : ['==', ['get', 'id'], ''],
    paint: {
      'circle-radius': 10,
      'circle-stroke-width': 3,
      'circle-stroke-color': '#ffffff',
      'circle-color': '#ff0000',
    },
  };
}

// Clustered mode: three layers. Unclustered: one. Plus the highlight in both cases.
function nexusSpecs() {
  if (state.clustered) {
    return [
      {
        id: 'clusters',
        type: 'circle',
        source: SRC_NEXUS,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#51bbd6', 10, '#6610f2', 50, '#20c997'],
          'circle-radius': ['step', ['get', 'point_count'], 15, 10, 25, 50, 35],
        },
      },
      {
        id: 'cluster-count',
        type: 'symbol',
        source: SRC_NEXUS,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-anchor': 'center',
          'text-justify': 'center',
          'symbol-placement': 'point',
        },
        paint: { 'text-color': '#ffffff' },
      },
      {
        id: 'unclustered-point',
        type: 'circle',
        source: SRC_NEXUS,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': isDark() ? '#4f5b67' : '#1f78b4',
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': isDark() ? '#e9ecef' : '#ffffff',
        },
      },
      nexusHighlightSpec(),
    ];
  }
  return [
    {
      id: 'all-points',
      type: 'circle',
      source: SRC_NEXUS,
      paint: {
        'circle-color': isDark() ? '#4f5b67' : '#1f78b4',
        'circle-radius': 7,
        'circle-stroke-width': 1,
        'circle-stroke-color': isDark() ? '#e9ecef' : '#ffffff',
      },
    },
    nexusHighlightSpec(),
  ];
}
```

Two deliberate differences from the React source, both behavior-preserving:

- `inFilter` handles the empty-list case. React relied on `useMemo` returning `null` (skipping the
  layer entirely) plus `onMapLoad` stuffing in a match-nothing filter. One helper is clearer than two
  mechanisms.
- `catchment-highlight`/`nexus-highlight` filters use `?? ''` instead of a ternary. Same result.

The commented-out theme-dependent cluster colors in the React file are left out — they were dead.

---

### Task 5: `map.js` part 2 — install, refresh, interactions

The idempotent-install pattern from gotcha #2. Everything here is safe to call repeatedly.

- [ ] **Step 1: Append the install/refresh functions**

```js
// ---------------------------------------------------------------------------
// Install — idempotent, so it is safe after every setStyle()
// ---------------------------------------------------------------------------
function addLayerIfMissing(map, spec) {
  if (!map.getLayer(spec.id)) map.addLayer(spec);
}

function installConus(map) {
  if (!map.getSource(SRC_CONUS)) {
    map.addSource(SRC_CONUS, { type: 'vector', url: PMTILES_URL });
  }
  addLayerIfMissing(map, catchmentsSpec());
  addLayerIfMissing(map, flowPathsSpec());
  addLayerIfMissing(map, gaugesSpec());
  addLayerIfMissing(map, catchmentHighlightSpec());
}

function installNexus(map) {
  if (!map.getSource(SRC_NEXUS)) {
    // cluster is a construction option — see teardownNexus for the toggle path.
    map.addSource(SRC_NEXUS, {
      type: 'geojson',
      data: state.nexusPoints, // never null: seeded with EMPTY_FC
      cluster: state.clustered,
      clusterRadius: 50,
      clusterMaxZoom: 14,
    });
  }
  if (state.nexusHidden) return; // React returned null from the nexusLayers memo
  for (const spec of nexusSpecs()) addLayerIfMissing(map, spec);
}

function installLayers(map) {
  installConus(map);
  installNexus(map);
  // Keep nexus + highlights above the fills, as onMapLoad did with moveLayer.
  for (const id of ['clusters', 'unclustered-point', 'cluster-count', 'all-points',
                    'nexus-highlight', 'catchment-highlight']) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

// Remove nexus layers before the source — MapLibre errors on a dangling reference.
function teardownNexus(map) {
  for (const id of NEXUS_LAYERS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SRC_NEXUS)) map.removeSource(SRC_NEXUS);
}

// ---------------------------------------------------------------------------
// Refresh — push state onto layers already on the map, no rebuild
// ---------------------------------------------------------------------------
function refresh(map) {
  if (map.getSource(SRC_NEXUS)) map.getSource(SRC_NEXUS).setData(state.nexusPoints);

  if (map.getLayer('catchments-layer')) {
    map.setFilter('catchments-layer', inFilter('divide_id', state.catchmentIds));
  }
  if (map.getLayer('flowpaths-layer')) {
    map.setFilter('flowpaths-layer', inFilter('id', state.flowPathIds));
  }
  if (map.getLayer('gauges-layer')) {
    map.setFilter('gauges-layer', inFilter('nex_id', state.nexusIds));
  }
  if (map.getLayer('catchment-highlight')) {
    map.setFilter('catchment-highlight',
      ['==', ['get', 'divide_id'], state.selectedCatchmentId ?? '']);
  }
  if (map.getLayer('nexus-highlight')) {
    map.setFilter('nexus-highlight', nexusHighlightSpec().filter);
  }

  for (const id of ['catchments-layer', 'catchment-highlight']) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', state.catchmentHidden ? 'none' : 'visible');
    }
  }
  for (const id of NEXUS_LAYERS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', state.nexusHidden ? 'none' : 'visible');
    }
  }
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------
function attachHoverCursor(map) {
  for (const layer of ['catchments-layer', 'unclustered-point', 'clusters', 'all-points']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }
}

async function handleClick(map, event) {
  // Query only what is actually visible, exactly as the React handler did.
  const layers = [];
  if (!state.nexusHidden) {
    layers.push(state.clustered ? 'unclustered-point' : 'all-points');
    if (state.clustered) layers.push('clusters');
  }
  if (!state.catchmentHidden) layers.push('catchments-layer');
  const present = layers.filter((id) => map.getLayer(id));
  if (!present.length) return;

  const features = map.queryRenderedFeatures(event.point, { layers: present });
  if (!features || !features.length) return;

  for (const feature of features) {
    const layerId = feature.layer.id;

    if (layerId === 'all-points' || layerId === 'unclustered-point') {
      const nexusId = feature.properties.id;
      state.selectedNexusId = nexusId;
      state.selectedCatchmentId = null;
      // Real element: actions.reset_teehr(); reset_troute(); set_nexus_id(); set_troute_id();
      onSelect({
        type: 'nexus',
        id: nexusId,
        trouteId: nexusId,
        teehrId: feature.properties.ngen_usgs !== 'none' ? feature.properties.ngen_usgs : null,
      });
      refresh(map);
      return;
    }

    if (layerId === 'clusters') {
      const zoom = await map.getSource(SRC_NEXUS)
        .getClusterExpansionZoom(feature.properties.cluster_id);
      map.flyTo({ center: feature.geometry.coordinates, zoom, speed: 1.2 });
      return;
    }

    if (layerId === 'catchments-layer') {
      const divideId = feature.properties.divide_id;
      state.selectedCatchmentId = divideId;
      state.selectedNexusId = null;
      onSelect({ type: 'catchment', id: divideId, trouteId: divideId, teehrId: null });
      refresh(map);
      return;
    }
  }
}
```

`onSelect` is the seam where the real `<ngiab-map>` calls store actions. In the spike it just
reports — Task 6 defines it.

---

### Task 6: `map.js` part 3 — fetch, boot, and the toggles

- [ ] **Step 1: Append the boot code**

```js
// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const cfg = window.__NGIAB__ || {};
const APP_ROOT_URL = cfg.APP_ROOT_URL || '/apps/ngiab/';
const statusEl = document.getElementById('map-status');
const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

function onSelect(selection) {
  console.log('[spike] selected', selection);
  setStatus(`${selection.type}: ${selection.id}`);
}

async function loadGeoSpatial(map, modelRunId) {
  setStatus(`loading ${modelRunId}…`);
  const url = `${APP_ROOT_URL}getGeoSpatialData/?model_run_id=${encodeURIComponent(modelRunId)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from getGeoSpatialData`);

  const body = await response.json();
  // The controller reports failure with HTTP 200 + an error key (controllers.py:173).
  if (body.error) throw new Error(body.error);

  state.nexusPoints = body.nexus ?? EMPTY_FC;
  state.catchmentIds = body.catchments ?? [];
  state.flowPathIds = body.flow_paths_ids ?? [];
  state.nexusIds = body.nexus_ids ?? [];
  state.selectedNexusId = null;
  state.selectedCatchmentId = null;

  refresh(map);

  // bounds is a flat [west, south, east, north] from gdf.total_bounds.
  if (body.bounds) map.fitBounds(body.bounds, { padding: 20, duration: 1000 });

  const n = state.nexusPoints.features?.length ?? 0;
  setStatus(`${modelRunId}: ${n} nexus, ${state.catchmentIds.length} catchments`);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const modelRunId =
  new URLSearchParams(window.location.search).get('model_run_id') || cfg.MODEL_RUN_ID || '';

const map = new maplibregl.Map({
  container: 'map',
  style: STYLE_URLS[state.theme],
  center: [-96, 40],
  zoom: 4,
});

map.on('load', () => {
  installLayers(map);
  attachHoverCursor(map);
  if (modelRunId) {
    loadGeoSpatial(map, modelRunId).catch((err) => {
      console.error('[spike] geospatial fetch failed', err);
      setStatus(`error: ${err.message}`);
    });
  } else {
    setStatus('no model_run_id — append ?model_run_id=… to the URL');
  }
});

map.on('click', (event) => {
  handleClick(map, event).catch((err) => console.error('[spike] click failed', err));
});

// setStyle() wipes every custom source and layer, so reinstall afterwards. styledata can fire
// more than once per swap; installLayers is idempotent, so that is harmless.
function setTheme(theme) {
  state.theme = theme;
  map.setStyle(STYLE_URLS[theme]);
  map.once('styledata', () => {
    installLayers(map);
    attachHoverCursor(map);
    refresh(map);
  });
}

// cluster is a source construction option — rebuild the source and its layers.
function setClustered(clustered) {
  state.clustered = clustered;
  teardownNexus(map);
  installNexus(map);
  installLayers(map);
  refresh(map);
}

document.getElementById('toggle-theme')
  .addEventListener('change', (e) => setTheme(e.target.checked ? 'dark' : 'light'));
document.getElementById('toggle-cluster')
  .addEventListener('change', (e) => setClustered(e.target.checked));
document.getElementById('toggle-nexus').addEventListener('change', (e) => {
  state.nexusHidden = e.target.checked;
  if (!state.nexusHidden) installNexus(map);
  installLayers(map);
  refresh(map);
});
document.getElementById('toggle-catchments').addEventListener('change', (e) => {
  state.catchmentHidden = e.target.checked;
  refresh(map);
});
```

- [ ] **Step 2: Find a model run id to test with**

```bash
curl -s "http://localhost:8000/apps/ngiab/getModelRuns/" | head -c 600
```

Use one of the returned ids, then open:
`http://localhost:8000/apps/ngiab/?model_run_id=<id>`

Putting it in the URL beats editing the template each time; `MODEL_RUN_ID` in `index.html` is just a
default for when the query param is absent.

- [ ] **Step 3: Commit**

```bash
git add tethysapp/ngiab/public/frontend/map.js
git commit -m "feat: vanilla MapLibre map spike ported from mapgl.js"
```

---

### Task 7: Verify parity

The vanilla map now *is* `/apps/ngiab/`, so React is no longer reachable for a side-by-side
comparison. Two ways to get one if you want it:

- **Compare against the commit before the cutover** — `git stash` your work, `git checkout 8eaceaf`,
  `npm run build`, look, then come back. Cleanest.
- **Or trust the checklist.** It was written from a full read of `mapgl.js`, and every item below maps
  to a specific line range in it.

Walk the list at `http://localhost:8000/apps/ngiab/?model_run_id=<id>`:

- [ ] Basemap renders; pmtiles vector tiles appear when zoomed past ~7
- [ ] Catchment fills appear for the selected run and nowhere else
- [ ] Flowpath lines and gauge circles appear
- [ ] Map fits to the run's bounds on load
- [ ] Hovering a catchment or nexus point shows a pointer cursor
- [ ] Clicking a nexus point turns it red, logs `{type:'nexus', id, trouteId, teehrId}`
- [ ] Clicking a catchment turns it red and clears the nexus highlight
- [ ] **Cluster toggle on** — points collapse into counted circles; clicking one zooms in
- [ ] **Cluster toggle off** — points return; a previously selected nexus still highlights
- [ ] **Dark toggle** — basemap darkens **and all layers survive** (gotcha #2)
- [ ] Dark + cluster together, in both orders
- [ ] "hide nexus" / "hide catchments" hide the right things and clicks skip hidden layers
- [ ] Console is clean — in particular no `Source "hydrofabric" not found` (gotcha #1)

**The two that actually matter:** the dark toggle and the cluster toggle. Everything else is a
transcription check; those two are the ones `react-map-gl` was handling invisibly.

- [ ] **If the spike passes**, fold it into Phase 1: `map.js` becomes
  `components/map/ngiab-map.js`, module `state` becomes store subscriptions, `onSelect` becomes
  store actions, `loadGeoSpatial` calls `appAPI.getGeoSpatialData`, and `setStatus` becomes
  `ngiab-toast`. The layer specs, `installLayers`, `refresh`, and `handleClick` port unchanged —
  which is the point of writing them independent of the store.

---

## Open questions for the real `<ngiab-map>`

1. **The show/hide inversion** (`show_nexus_geometry()` guarded by `if (!isNexusHidden)`). The spike
   preserves it. Decide the intended behavior before Phase 1.
2. **`in` vs `match` filters.** `['any', ['in', 'divide_id', ...ids]]` with thousands of ids is slow
   to evaluate per tile. `['match', ['get','divide_id'], ids, true, false]` is the modern form and
   materially faster. Left as-is here for parity; worth measuring against a large run.
3. **Toast on fetch success.** The React version toasts on every successful load
   (`"Successfully retrieved Model Run Data"`). Keep, or drop as noise?
4. **`removeProtocol` on teardown.** Registration is global; if `<ngiab-map>` can be unmounted and
   remounted, decide whether the protocol is registered at module scope (once, never removed) or
   tied to element lifecycle. Module scope is simpler and almost certainly right.
