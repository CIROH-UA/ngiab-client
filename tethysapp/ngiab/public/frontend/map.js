// Vanilla MapLibre map for the NGIAB visualizer.
// Ported from reactapp/features/Map/components/mapgl.js, with the nexus layers removed and
// the single merged.pmtiles archive replaced by two geometry-only archives.
//
// Notes carried over from the port (see docs/superpowers/plans/2026-08-03-map-spike-plan.md):
//   - setStyle() destroys every custom source and layer, so installLayers() is idempotent and
//     re-runs after each style swap.
//   - Layer-scoped hover listeners live on the map, not the style, so they attach exactly once.
//
// ---------------------------------------------------------------------------
// SOURCE DATA - verified against the archives' pmtiles metadata on 2026-08-03
//
//   divides.pmtiles    source-layer "divides"    zoom 4-10
//                      fields: toid, upstream_id, num_upstreams          (all Number)
//   flowpaths.pmtiles  source-layer "flowpaths"  zoom 1-10
//                      fields: divide_id, toid, upstream_id, order, num_upstreams  (all Number)
//
// Two consequences, both different from the old merged.pmtiles:
//
//   1. IDS ARE NUMERIC. The API returns prefixed strings ("cat-1234"); these tiles store bare
//      numbers. Everything from the API is run through toNumericIds() before it reaches a filter.
//
//   2. "divides" HAS NO divide_id PROPERTY. Only toid / upstream_id / num_upstreams. The likely
//      reason is that divide_id was promoted to the vector-tile feature id (tippecanoe's
//      --use-attribute-for-id removes the attribute when it promotes it), which also explains why
//      "flowpaths" still carries divide_id as a property but "divides" does not. So catchments are
//      filtered and identified by feature id via the ['id'] expression.
//
//      ⚠ If catchments render blank, this assumption is wrong. See CATCHMENT_KEY below - it is a
//      one-line change. To find the truth, click where a catchment should be and read the console:
//      the click handler logs the raw feature id and properties.
// ---------------------------------------------------------------------------

import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

import './components/ngiab-chart.js';
import './components/ngiab-model-runs.js';
import appAPI from './api/app.js';
import { getModelRunId } from './config.js';
import { store, actions } from './store/app-store.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STYLE_URLS = {
  light: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/light-style.json',
  dark: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json',
};

const PMTILES_BASE =
  'pmtiles://https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/only_geometry/upstream_index/';
const DIVIDES_URL = `${PMTILES_BASE}divides.pmtiles`;
const FLOWPATHS_URL = `${PMTILES_BASE}flowpaths.pmtiles`;

// MapLibre source ids (ours) and the source-layer names inside each archive (theirs).
const SRC_DIVIDES = 'divides';
const SRC_FLOWPATHS = 'flowpaths';
const LAYER_DIVIDES = 'divides';
const LAYER_FLOWPATHS = 'flowpaths';

// How a catchment is identified in the "divides" layer.
//   'id'        -> the vector-tile feature id, matched with the ['id'] expression (current guess)
//   any string  -> a property name, e.g. 'divide_id' or 'upstream_id'
const CATCHMENT_KEY = 'id';

// Layers whose visibility follows catchmentHidden().
const CATCHMENT_LAYERS = ['catchments-layer', 'catchment-highlight'];
// Must stay above the catchment fill.
const TOP_LAYERS = ['flowpaths-layer', 'catchment-highlight'];

// ---------------------------------------------------------------------------
// State
//
// Shared state (theme, selection, layer flags) lives in the global store so the chart can
// react to the same selection the map sets. Only map-scoped caches stay here: the search
// index and the catchment -> nexus map are derived from the run payload and from loaded
// vector tiles, churn on every pan, and nothing outside the map reads them.
// ---------------------------------------------------------------------------
const local = {
  catchmentIds: [], // numeric, for the layer filters
  catchmentIndex: [], // [{ label: 'cat-1015', numeric: 1015 }] for the search bar
  teehrNexusIds: [], // numeric nexus ids that have TEEHR results
  teehrUsgsByNexus: new Map(), // nexus id -> USGS gauge id
};

const isDark = () => store.get().theme === 'dark';
const catchmentHidden = () => store.get().layers.catchmentHidden;
const showTeehr = () => store.get().layers.showTeehr;
const selectedCatchmentId = () => store.get().selection.id;

// Global, not per-map.
maplibregl.addProtocol('pmtiles', new Protocol({ metadata: true }).tile);

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

// "cat-1234" | "1234" | 1234 -> 1234. Anything unparseable is dropped rather than silently
// becoming NaN, which would never match and would be invisible to debug.
function toNumericIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const raw of ids) {
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/^\D+/, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

// The left-hand side of a catchment comparison: the feature id, or a property lookup.
const catchmentRef = () => (CATCHMENT_KEY === 'id' ? ['id'] : ['get', CATCHMENT_KEY]);

// 'in' over a literal array is the modern form and evaluates far faster than the legacy
// ['any', ['in', key, ...ids]] the React version used with thousands of ids.
const catchmentSetFilter = () =>
  local.catchmentIds.length
    ? ['in', catchmentRef(), ['literal', local.catchmentIds]]
    : ['==', catchmentRef(), -1]; // match nothing

const catchmentHighlightFilter = () =>
  selectedCatchmentId() == null
    ? ['==', catchmentRef(), -1]
    : ['==', catchmentRef(), selectedCatchmentId()];

// Flowpaths carry divide_id as a real property, so they are filtered to the same catchment set.
// The old flow_paths_ids payload (nexus "toid" values) is no longer used - flowpath and divide
// are 1:1 in the hydrofabric, so this selects the same lines without a second id list.
const flowPathsFilter = () =>
  local.catchmentIds.length
    ? ['in', ['get', 'divide_id'], ['literal', local.catchmentIds]]
    : ['==', ['get', 'divide_id'], -1];

const visibility = (hidden) => ({ visibility: hidden ? 'none' : 'visible' });

// ---------------------------------------------------------------------------
// TEEHR colouring
//
// TEEHR results are keyed to USGS gauges, which crosswalk to *nexus* ids -- there is no
// direct catchment key. Both archives carry `toid`, which in the hydrofabric is the
// downstream nexus, so "this geometry drains to a TEEHR-evaluated nexus" is expressible as
// a data-driven paint expression. No extra layer, no extra draw pass.
// ---------------------------------------------------------------------------
const TEEHR_FILL = { light: 'rgba(31, 120, 180, 0.55)', dark: 'rgba(32, 201, 151, 0.55)' };
const PLAIN_FILL = { light: 'rgba(91, 44, 111, 0.316)', dark: 'rgba(238, 51, 119, 0.316)' };
const TEEHR_LINE = { light: '#1f78b4', dark: '#20c997' };
const PLAIN_LINE = { light: '#000000', dark: '#0077bb' };

const themed = (pair) => (isDark() ? pair.dark : pair.light);

const hasTeehrNexus = () => ['in', ['get', 'toid'], ['literal', local.teehrNexusIds]];

// Falls back to a flat colour when there is nothing to highlight, so the expression stays
// valid and cheap for runs with no TEEHR output.
const teehrAware = (teehrColor, plainColor) =>
  showTeehr() && local.teehrNexusIds.length
    ? ['case', hasTeehrNexus(), themed(teehrColor), themed(plainColor)]
    : themed(plainColor);

const catchmentFillColor = () => teehrAware(TEEHR_FILL, PLAIN_FILL);
const flowPathsLineColor = () => teehrAware(TEEHR_LINE, PLAIN_LINE);

// ---------------------------------------------------------------------------
// Layer specs
// ---------------------------------------------------------------------------
function catchmentsSpec() {
  return {
    id: 'catchments-layer',
    type: 'fill',
    source: SRC_DIVIDES,
    'source-layer': LAYER_DIVIDES,
    filter: catchmentSetFilter(),
    paint: {
      'fill-color': catchmentFillColor(),
      'fill-outline-color': isDark() ? 'rgba(238, 51, 119, 0.7)' : 'rgba(91, 44, 111, 0.7)',
      'fill-opacity': { stops: [[7, 0], [11, 1]] },
    },
    layout: visibility(catchmentHidden()),
  };
}

function catchmentHighlightSpec() {
  return {
    id: 'catchment-highlight',
    type: 'fill',
    source: SRC_DIVIDES,
    'source-layer': LAYER_DIVIDES,
    filter: catchmentHighlightFilter(),
    paint: {
      'fill-color': '#ff0000',
      'fill-outline-color': '#ffffff',
      'fill-opacity': 0.5,
    },
    layout: visibility(catchmentHidden()),
  };
}

function flowPathsSpec() {
  return {
    id: 'flowpaths-layer',
    type: 'line',
    source: SRC_FLOWPATHS,
    'source-layer': LAYER_FLOWPATHS,
    filter: flowPathsFilter(),
    paint: {
      'line-color': flowPathsLineColor(),
      'line-width': { stops: [[7, 1], [10, 2]] },
      'line-opacity': { stops: [[7, 0], [11, 1]] },
    },
  };
}

// ---------------------------------------------------------------------------
// Install - idempotent, so it is safe to re-run after every setStyle()
// ---------------------------------------------------------------------------
function addLayerIfMissing(map, spec) {
  if (!map.getLayer(spec.id)) map.addLayer(spec);
}

function installLayers(map) {
  if (!map.getSource(SRC_DIVIDES)) {
    map.addSource(SRC_DIVIDES, { type: 'vector', url: DIVIDES_URL });
  }
  if (!map.getSource(SRC_FLOWPATHS)) {
    map.addSource(SRC_FLOWPATHS, { type: 'vector', url: FLOWPATHS_URL });
  }
  addLayerIfMissing(map, catchmentsSpec());
  addLayerIfMissing(map, flowPathsSpec());
  addLayerIfMissing(map, catchmentHighlightSpec());

  for (const id of TOP_LAYERS) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

// ---------------------------------------------------------------------------
// Refresh - push state onto layers already on the map
// ---------------------------------------------------------------------------
function setFilterIfPresent(map, id, filter) {
  if (map.getLayer(id)) map.setFilter(id, filter);
}

function setPaintIfPresent(map, id, prop, value) {
  if (map.getLayer(id)) map.setPaintProperty(id, prop, value);
}

function refresh(map) {
  setFilterIfPresent(map, 'catchments-layer', catchmentSetFilter());
  setFilterIfPresent(map, 'flowpaths-layer', flowPathsFilter());
  setFilterIfPresent(map, 'catchment-highlight', catchmentHighlightFilter());

  setPaintIfPresent(map, 'catchments-layer', 'fill-color', catchmentFillColor());
  setPaintIfPresent(map, 'flowpaths-layer', 'line-color', flowPathsLineColor());

  for (const id of CATCHMENT_LAYERS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', catchmentHidden() ? 'none' : 'visible');
    }
  }
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

// Attach ONCE. Layer-scoped listeners live on the map, not the style, so they survive
// setStyle() - re-attaching after a style swap would just accumulate duplicates.
function attachHoverCursor(map) {
  map.on('mouseenter', 'catchments-layer', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'catchments-layer', () => {
    map.getCanvas().style.cursor = '';
  });
}

function handleClick(map, event) {
  if (catchmentHidden() || !map.getLayer('catchments-layer')) return;

  const features = map.queryRenderedFeatures(event.point, { layers: ['catchments-layer'] });
  if (!features || !features.length) return;

  const feature = features[0];
  // Logged unconditionally: this is how you confirm the CATCHMENT_KEY assumption at the top
  // of the file against real tile data.
  console.log('[map] catchment feature', { id: feature.id, properties: feature.properties });

  const catchmentId = CATCHMENT_KEY === 'id' ? feature.id : feature.properties[CATCHMENT_KEY];
  if (catchmentId == null) {
    console.warn(`[map] no "${CATCHMENT_KEY}" on the clicked feature - check CATCHMENT_KEY`);
    return;
  }

  // The geometry joins to TEEHR through its downstream nexus, so the gauge for a clicked
  // catchment is whatever gauge sits on its `toid`.
  selectCatchment(map, {
    numeric: catchmentId,
    label: labelForCatchment(catchmentId),
    nexusId: feature.properties.toid,
    fly: false, // the user already clicked where they wanted to be
  });
}

// The tiles only carry numbers; the run's payload has the "cat-N" labels.
function labelForCatchment(numericId) {
  const entry = local.catchmentIndex.find((candidate) => candidate.numeric === numericId);
  return entry ? entry.label : String(numericId);
}

// ---------------------------------------------------------------------------
// Locating a catchment
//
// There is no per-catchment geometry on the client -- getGeoSpatialData returns only the
// run's overall bounds. So a search hit is located by querying the vector source for the
// matching feature and unioning its coordinate extent.
//
// Caveat: querySourceFeatures only sees tiles that are currently LOADED. After the initial
// fitBounds to the run that covers the run's own catchments, but a hit can still miss if
// the tile is not resident. Callers must handle null -- the highlight filter is set either
// way, so the feature colours in as soon as it is panned into view. The clean fix is a
// backend lookup returning the catchment's bbox from the geopackage.
// ---------------------------------------------------------------------------
function extendBounds(bounds, coords) {
  // GeoJSON coordinate arrays nest arbitrarily deep (Polygon vs MultiPolygon).
  if (typeof coords[0] === 'number') {
    const [lng, lat] = coords;
    bounds[0] = Math.min(bounds[0], lng);
    bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lng);
    bounds[3] = Math.max(bounds[3], lat);
    return;
  }
  for (const part of coords) extendBounds(bounds, part);
}

function catchmentBounds(map, numericId) {
  if (!map.getSource(SRC_DIVIDES)) return null;
  const features = map.querySourceFeatures(SRC_DIVIDES, {
    sourceLayer: LAYER_DIVIDES,
    filter: ['==', catchmentRef(), numericId],
  });
  if (!features.length) return null;

  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const feature of features) {
    if (feature.geometry?.coordinates) extendBounds(bounds, feature.geometry.coordinates);
  }
  return Number.isFinite(bounds[0]) ? bounds : null;
}

// Single entry point for "this catchment is now selected", used by both the map click and
// the search bar so they cannot drift.
function selectCatchment(map, { numeric, label, nexusId, fly }) {
  const catchmentLabel = label ?? String(numeric);
  const teehrId =
    nexusId !== undefined ? (local.teehrUsgsByNexus.get(nexusId) ?? null) : lookupTeehrId(numeric);

  // The store owns the selection; the subscription in the boot section repaints the
  // highlight. The troute endpoint wants the prefixed label ("cat-1015"), not the bare
  // numeric tile id.
  actions.selectCatchment({
    id: numeric,
    label: catchmentLabel,
    trouteId: catchmentLabel,
    teehrId,
  });

  let located = true;
  if (fly) {
    const bounds = catchmentBounds(map, numeric);
    if (bounds) map.fitBounds(bounds, { padding: 80, duration: 800, maxZoom: 12 });
    else located = false;
  }

  reportSelection({ label: catchmentLabel, teehrId, located });
}

// catchment -> downstream nexus, harvested from whatever divide tiles are loaded.
//
// Built in ONE pass and cached, rather than a filtered query per lookup: the search list
// needs this for every visible row on every keystroke, and querySourceFeatures scans all
// loaded tiles each call. Rebuilt when tile loading settles, since more tiles mean more
// known catchments.
const nexusByCatchment = new Map();

function reindexCatchmentNexus(map) {
  if (!map.getSource(SRC_DIVIDES)) return;
  let features;
  try {
    features = map.querySourceFeatures(SRC_DIVIDES, { sourceLayer: LAYER_DIVIDES });
  } catch {
    return; // source not ready yet
  }
  for (const feature of features) {
    const key = CATCHMENT_KEY === 'id' ? feature.id : feature.properties?.[CATCHMENT_KEY];
    const toid = feature.properties?.toid;
    if (key !== undefined && toid !== undefined) nexusByCatchment.set(key, toid);
  }
}

// null means "no TEEHR gauge, or this catchment's tile has not loaded yet" -- the two are
// not distinguishable client-side, which is why the search row shows a badge only on a
// positive match and never a "no TEEHR" marker.
function lookupTeehrId(numericId) {
  const nexusId = nexusByCatchment.get(numericId);
  return nexusId === undefined ? null : (local.teehrUsgsByNexus.get(nexusId) ?? null);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const statusEl = document.getElementById('map-status');

// severity mirrors the backend's own vocabulary ('info' | 'warning' | 'error') so a
// missing TEEHR warehouse does not get styled like a failure.
const setStatus = (msg, severity = null) => {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.dataset.severity = msg && severity ? severity : '';
  statusEl.classList.toggle('is-busy', severity === 'busy');
};

const panelEl = document.getElementById('map-panel');
const panelIdEl = document.getElementById('map-panel-id');
const panelTeehrEl = document.getElementById('map-panel-teehr');
const panelNoteEl = document.getElementById('map-panel-note');

// Renders the selected-feature panel. The variable / troute / TEEHR-config pickers belong
// here once the chart component exists.
function reportSelection({ label, teehrId, located }) {
  if (!panelEl) return;

  panelEl.hidden = false;
  panelIdEl.textContent = label;
  panelTeehrEl.textContent = teehrId
    ? `TEEHR · ${teehrId}`
    : 'No TEEHR results for this catchment';

  const missing = located === false;
  panelNoteEl.hidden = !missing;
  if (missing) {
    panelNoteEl.textContent =
      'Geometry not in the loaded tiles yet - it will highlight once you pan or zoom to it.';
  }
}

// Which nexuses have TEEHR results for this run. Deliberately NOT derived from the nexus
// payload's ngen_usgs column: that reflects the warehouse-wide crosswalk with no
// configuration filter, so it reports gauges this run never evaluated.
// A missing/failed warehouse is not an error here -- the map just renders uncoloured.
async function loadTeehrLocations(modelRunId) {
  const body = await appAPI.getTeehrLocations({ model_run_id: modelRunId });
  const locations = body.teehr_locations ?? [];

  local.teehrUsgsByNexus = new Map();
  for (const { nexus_id: nexusId, usgs_id: usgsId } of locations) {
    const [numeric] = toNumericIds([nexusId]);
    if (numeric !== undefined) local.teehrUsgsByNexus.set(numeric, usgsId);
  }
  local.teehrNexusIds = [...local.teehrUsgsByNexus.keys()];

  return { count: local.teehrNexusIds.length, status: body.teehr_status };
}

async function loadGeoSpatial(map, modelRunId) {
  setStatus(`Loading ${modelRunId}`, 'busy');

  // getJSON raises on a non-ok status AND on the HTTP-200-plus-error-key shape several
  // controllers use, so both failure modes arrive here as exceptions.
  const body = await appAPI.getGeoSpatialData({ model_run_id: modelRunId });

  // "cat-1234" -> 1234, because these archives store ids as numbers. The original label
  // is kept for the search index and for anything user-facing.
  const catchments = Array.isArray(body.catchments) ? body.catchments : [];
  local.catchmentIndex = [];
  for (const label of catchments) {
    const [numeric] = toNumericIds([label]);
    if (numeric !== undefined) local.catchmentIndex.push({ label: String(label), numeric });
  }
  local.catchmentIds = local.catchmentIndex.map((entry) => entry.numeric);
  actions.clearSelection();

  refresh(map);

  // bounds is a flat [west, south, east, north] from gdf.total_bounds.tolist().
  if (body.bounds) map.fitBounds(body.bounds, { padding: 20, duration: 1000 });

  const dropped = catchments.length - local.catchmentIds.length;
  return {
    catchments: local.catchmentIds.length,
    dropped: dropped > 0 ? dropped : 0,
  };
}

function loadOrReport(map, modelRunId) {
  // Geometry is required; TEEHR colouring is not. Run both concurrently and let the TEEHR
  // half fail soft -- an unconfigured or broken warehouse should still give you a map.
  Promise.all([
    loadGeoSpatial(map, modelRunId),
    loadTeehrLocations(modelRunId).catch((error) => {
      console.warn('[map] TEEHR locations unavailable', error);
      return { count: 0, status: error.message };
    }),
  ])
    .then(([geo, teehr]) => {
      refresh(map); // paint the TEEHR colours once both halves have landed
      // A run with no catchment outputs renders an empty map, which is indistinguishable
      // from a broken one unless it is said out loud.
      if (!geo.catchments) {
        setStatus(
          'This model run has no catchment outputs, so nothing is drawn.',
          'warning',
        );
        return;
      }

      const parts = [`${geo.catchments} catchments`];
      if (geo.dropped) parts.push(`${geo.dropped} unparseable ids dropped`);
      parts.push(teehr.count ? `${teehr.count} TEEHR nexus` : (teehr.status ?? 'no TEEHR'));
      setStatus(parts.join(' · '));
    })
    .catch((error) => {
      console.error('[map] geospatial fetch failed', error);
      setStatus(`Could not load this model run: ${error.message}`, 'error');
    });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
// Seed from the URL so a shared link still opens the right run; <ngiab-model-runs> takes
// over from there and keeps the URL in step.
actions.setModelRun(getModelRunId() || null);

// Which run's geometry is currently drawn. Compared against the store so a run change
// reloads exactly once, whether it came from the URL, the selector, or an unregister.
let loadedRunId = null;

function syncModelRun(map) {
  const runId = store.get().modelRunId;
  if (runId === loadedRunId) return;
  loadedRunId = runId;

  if (!runId) {
    local.catchmentIds = [];
    local.catchmentIndex = [];
    local.teehrNexusIds = [];
    local.teehrUsgsByNexus = new Map();
    refresh(map);
    setStatus('No model run selected.', 'warning');
    return;
  }
  loadOrReport(map, runId);
}

const map = new maplibregl.Map({
  container: 'map',
  style: STYLE_URLS[store.get().theme],
  center: [-96, 40],
  zoom: 4,
});

map.on('load', () => {
  installLayers(map);
  attachHoverCursor(map); // once only - see the note on the function
  syncModelRun(map);
});

map.on('click', (event) => handleClick(map, event));

// 'idle' fires once tile loading and rendering have settled, so this is where newly
// arrived divide tiles get folded into the catchment -> nexus index.
map.on('idle', () => reindexCatchmentNexus(map));

// Surface tile/source failures instead of leaving a silently empty map - the most likely
// cause of a blank render is a bad pmtiles URL or source-layer name.
map.on('error', (event) => {
  console.error('[map] maplibre error', event.error ?? event);
});

// One subscription repaints everything the store owns -- selection highlight, layer
// visibility, TEEHR tint. Components that change state call an action and let this run,
// rather than each call site remembering to refresh.
const chartPaneEl = document.getElementById('chart-pane');

store.subscribe(() => {
  refresh(map);
  if (map.isStyleLoaded()) syncModelRun(map);

  // The chart pane only exists while something is selected. Showing or hiding it changes
  // the map container's height, and MapLibre does not observe that on its own -- without
  // an explicit resize the canvas keeps the old dimensions and the map appears stretched.
  if (!chartPaneEl) return;
  const shouldShow = Boolean(store.get().selection.id);
  if (chartPaneEl.hidden !== shouldShow) return; // already in the right state
  chartPaneEl.hidden = !shouldShow;
  map.resize();
});

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

// setStyle() wipes every custom source and layer.
//
// Reinstalling on `map.once('styledata')` is not enough: styledata fires several times
// during a swap and the FIRST one can arrive before the new style is ready, so the layers
// get added and then thrown away when the style finishes loading. That is why the dark
// basemap rendered no catchments -- everything visible was the basemap's own data.
//
// Watching every styledata and reinstalling whenever our source has gone missing is
// self-healing, and cheap because the guard is a single getSource() lookup.
function setTheme(theme) {
  actions.setTheme(theme);
  map.setStyle(STYLE_URLS[theme]);
}

map.on('styledata', () => {
  // addSource throws while the style is still loading, and this event also fires during
  // the initial load, so both guards are load-bearing.
  if (!map.isStyleLoaded()) return;
  if (map.getSource(SRC_DIVIDES)) return; // still installed, nothing to do
  installLayers(map);
  refresh(map);
});

function setCatchmentHidden(hidden) {
  actions.setLayer('catchmentHidden', hidden);
}

function setShowTeehr(show) {
  actions.setLayer('showTeehr', show);
}

function bindToggle(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', (event) => handler(event.target.checked));
}

// ---------------------------------------------------------------------------
// Search
//
// Replaces the React catchment/nexus id dropdowns. Matching is client-side over the run's
// own catchment list, so there is no request per keystroke and no need to page through
// thousands of <option>s. Scoped to catchments because they are the only geometry rendered.
// ---------------------------------------------------------------------------
const SEARCH_LIMIT = 25;

const searchInput = document.getElementById('map-search');
const searchClear = document.getElementById('map-search-clear');
const resultsEl = document.getElementById('map-search-results');
const emptyEl = document.getElementById('map-search-empty');

let matches = [];
let activeIndex = -1;
// Tracks whether a search actually came back empty. Without this, closing the list after
// picking a result -- which leaves the chosen label in the input -- renders as
// "No matching catchment in this run."
let noMatches = false;

// Rank exact, then prefix, then substring, so typing a full id puts it first.
function searchCatchments(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  // Full scan, no early exit: a few thousand string compares is microseconds, and bailing
  // early could skip an exact match that happens to sort after SEARCH_LIMIT substring hits.
  const exact = [];
  const prefix = [];
  const contains = [];
  for (const entry of local.catchmentIndex) {
    const label = entry.label.toLowerCase();
    if (label === q) exact.push(entry);
    else if (label.startsWith(q) || String(entry.numeric).startsWith(q)) prefix.push(entry);
    else if (label.includes(q)) contains.push(entry);
  }
  return [...exact, ...prefix, ...contains].slice(0, SEARCH_LIMIT);
}

function hasTeehr(numericId) {
  return lookupTeehrId(numericId) != null;
}

function renderResults() {
  resultsEl.textContent = '';
  for (let i = 0; i < matches.length; i += 1) {
    const entry = matches[i];
    const li = document.createElement('li');
    li.id = `map-search-opt-${i}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === activeIndex));

    const id = document.createElement('span');
    id.className = 'id';
    id.textContent = entry.label;
    li.append(id);

    // Positive-only: see lookupTeehrId on why absence is not "no TEEHR".
    if (hasTeehr(entry.numeric)) {
      const badge = document.createElement('span');
      badge.className = 'teehr';
      badge.textContent = 'TEEHR';
      li.append(badge);
    }

    li.addEventListener('mousedown', (event) => {
      event.preventDefault(); // keep focus in the input
      choose(i);
    });
    resultsEl.append(li);
  }

  const open = matches.length > 0;
  resultsEl.hidden = !open;
  emptyEl.hidden = !noMatches;
  searchInput.setAttribute('aria-expanded', String(open));
  if (activeIndex >= 0) {
    searchInput.setAttribute('aria-activedescendant', `map-search-opt-${activeIndex}`);
    resultsEl.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  } else {
    searchInput.removeAttribute('aria-activedescendant');
  }
}

function closeResults() {
  matches = [];
  activeIndex = -1;
  noMatches = false;
  renderResults();
}

function choose(index) {
  const entry = matches[index];
  if (!entry) return;
  searchInput.value = entry.label;
  closeResults();
  selectCatchment(map, { numeric: entry.numeric, label: entry.label, fly: true });
}

function moveActive(delta) {
  if (!matches.length) return;
  activeIndex = (activeIndex + delta + matches.length) % matches.length;
  renderResults();
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    matches = searchCatchments(searchInput.value);
    activeIndex = matches.length ? 0 : -1;
    noMatches = Boolean(searchInput.value.trim()) && matches.length === 0;
    searchClear.hidden = !searchInput.value;
    renderResults();
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // Enter with one match and no explicit highlight should still pick it.
      choose(activeIndex >= 0 ? activeIndex : 0);
    } else if (event.key === 'Escape') {
      closeResults();
    }
  });

  // Re-open the list when returning to a non-empty box.
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim() && !matches.length) {
      matches = searchCatchments(searchInput.value);
      activeIndex = matches.length ? 0 : -1;
      noMatches = matches.length === 0;
      renderResults();
    }
  });

  searchInput.addEventListener('blur', () => closeResults());

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    closeResults();
    searchInput.focus();
  });
}

bindToggle('toggle-theme', (on) => setTheme(on ? 'dark' : 'light'));
bindToggle('toggle-catchments', setCatchmentHidden);
bindToggle('toggle-teehr', setShowTeehr);
