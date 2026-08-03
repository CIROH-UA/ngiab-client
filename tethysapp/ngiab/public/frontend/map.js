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
// SOURCE DATA — verified against the archives' pmtiles metadata on 2026-08-03
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
//      ⚠ If catchments render blank, this assumption is wrong. See CATCHMENT_KEY below — it is a
//      one-line change. To find the truth, click where a catchment should be and read the console:
//      the click handler logs the raw feature id and properties.
// ---------------------------------------------------------------------------

import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

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

// Layers whose visibility follows state.catchmentHidden.
const CATCHMENT_LAYERS = ['catchments-layer', 'catchment-highlight'];
// Must stay above the catchment fill.
const TOP_LAYERS = ['flowpaths-layer', 'catchment-highlight'];

// ---------------------------------------------------------------------------
// State — becomes the global store in <ngiab-map>
// ---------------------------------------------------------------------------
const state = {
  theme: 'light',
  catchmentHidden: false,
  selectedCatchmentId: null, // numeric, to match the tiles
  catchmentIds: [], // numeric
};

const isDark = () => state.theme === 'dark';

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
  state.catchmentIds.length
    ? ['in', catchmentRef(), ['literal', state.catchmentIds]]
    : ['==', catchmentRef(), -1]; // match nothing

const catchmentHighlightFilter = () =>
  state.selectedCatchmentId == null
    ? ['==', catchmentRef(), -1]
    : ['==', catchmentRef(), state.selectedCatchmentId];

// Flowpaths carry divide_id as a real property, so they are filtered to the same catchment set.
// The old flow_paths_ids payload (nexus "toid" values) is no longer used — flowpath and divide
// are 1:1 in the hydrofabric, so this selects the same lines without a second id list.
const flowPathsFilter = () =>
  state.catchmentIds.length
    ? ['in', ['get', 'divide_id'], ['literal', state.catchmentIds]]
    : ['==', ['get', 'divide_id'], -1];

const visibility = (hidden) => ({ visibility: hidden ? 'none' : 'visible' });

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
      'fill-color': isDark() ? 'rgba(238, 51, 119, 0.316)' : 'rgba(91, 44, 111, 0.316)',
      'fill-outline-color': isDark() ? 'rgba(238, 51, 119, 0.7)' : 'rgba(91, 44, 111, 0.7)',
      'fill-opacity': { stops: [[7, 0], [11, 1]] },
    },
    layout: visibility(state.catchmentHidden),
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
    layout: visibility(state.catchmentHidden),
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
      'line-color': isDark() ? '#0077bb' : '#000000',
      'line-width': { stops: [[7, 1], [10, 2]] },
      'line-opacity': { stops: [[7, 0], [11, 1]] },
    },
  };
}

// ---------------------------------------------------------------------------
// Install — idempotent, so it is safe to re-run after every setStyle()
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
// Refresh — push state onto layers already on the map
// ---------------------------------------------------------------------------
function setFilterIfPresent(map, id, filter) {
  if (map.getLayer(id)) map.setFilter(id, filter);
}

function refresh(map) {
  setFilterIfPresent(map, 'catchments-layer', catchmentSetFilter());
  setFilterIfPresent(map, 'flowpaths-layer', flowPathsFilter());
  setFilterIfPresent(map, 'catchment-highlight', catchmentHighlightFilter());

  for (const id of CATCHMENT_LAYERS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', state.catchmentHidden ? 'none' : 'visible');
    }
  }
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

// Attach ONCE. Layer-scoped listeners live on the map, not the style, so they survive
// setStyle() — re-attaching after a style swap would just accumulate duplicates.
function attachHoverCursor(map) {
  map.on('mouseenter', 'catchments-layer', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'catchments-layer', () => {
    map.getCanvas().style.cursor = '';
  });
}

function handleClick(map, event) {
  if (state.catchmentHidden || !map.getLayer('catchments-layer')) return;

  const features = map.queryRenderedFeatures(event.point, { layers: ['catchments-layer'] });
  if (!features || !features.length) return;

  const feature = features[0];
  // Logged unconditionally: this is how you confirm the CATCHMENT_KEY assumption at the top
  // of the file against real tile data.
  console.log('[map] catchment feature', { id: feature.id, properties: feature.properties });

  const catchmentId = CATCHMENT_KEY === 'id' ? feature.id : feature.properties[CATCHMENT_KEY];
  if (catchmentId == null) {
    console.warn(`[map] no "${CATCHMENT_KEY}" on the clicked feature — check CATCHMENT_KEY`);
    return;
  }

  state.selectedCatchmentId = catchmentId;
  onSelect({ type: 'catchment', id: catchmentId, trouteId: catchmentId });
  refresh(map);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const cfg = window.__NGIAB__ || {};
const APP_ROOT_URL = cfg.APP_ROOT_URL || '/apps/ngiab/';

const statusEl = document.getElementById('map-status');
const setStatus = (msg) => {
  if (statusEl) statusEl.textContent = msg;
};

// The seam where <ngiab-map> will dispatch store actions instead.
function onSelect(selection) {
  console.log('[map] selected', selection);
  setStatus(`${selection.type}: ${selection.id}`);
}

async function loadGeoSpatial(map, modelRunId) {
  setStatus(`loading ${modelRunId}…`);

  const url = `${APP_ROOT_URL}getGeoSpatialData/?model_run_id=${encodeURIComponent(modelRunId)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from getGeoSpatialData`);

  const body = await response.json();
  // The controller reports failure with HTTP 200 plus an error key, so response.ok is not
  // enough of a check (tethysapp/ngiab/controllers.py, getGeoSpatialData).
  if (body.error) throw new Error(body.error);

  // "cat-1234" -> 1234, because these archives store ids as numbers.
  state.catchmentIds = toNumericIds(body.catchments);
  state.selectedCatchmentId = null;

  refresh(map);

  // bounds is a flat [west, south, east, north] from gdf.total_bounds.tolist().
  if (body.bounds) map.fitBounds(body.bounds, { padding: 20, duration: 1000 });

  const dropped = (body.catchments?.length ?? 0) - state.catchmentIds.length;
  setStatus(
    `${modelRunId}: ${state.catchmentIds.length} catchments` +
      (dropped > 0 ? ` (${dropped} unparseable ids dropped)` : ''),
  );
}

function loadOrReport(map, modelRunId) {
  loadGeoSpatial(map, modelRunId).catch((error) => {
    console.error('[map] geospatial fetch failed', error);
    setStatus(`error: ${error.message}`);
  });
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
  attachHoverCursor(map); // once only — see the note on the function
  if (modelRunId) {
    loadOrReport(map, modelRunId);
  } else {
    setStatus('no model_run_id — append ?model_run_id=… to the URL');
  }
});

map.on('click', (event) => handleClick(map, event));

// Surface tile/source failures instead of leaving a silently empty map — the most likely
// cause of a blank render is a bad pmtiles URL or source-layer name.
map.on('error', (event) => {
  console.error('[map] maplibre error', event.error ?? event);
});

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

// setStyle() wipes every custom source and layer, so reinstall afterwards. styledata can fire
// more than once per swap, but installLayers is idempotent, so that is harmless.
function setTheme(theme) {
  state.theme = theme;
  map.setStyle(STYLE_URLS[theme]);
  map.once('styledata', () => {
    installLayers(map);
    refresh(map);
  });
}

function setCatchmentHidden(hidden) {
  state.catchmentHidden = hidden;
  refresh(map);
}

function bindToggle(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', (event) => handler(event.target.checked));
}

bindToggle('toggle-theme', (on) => setTheme(on ? 'dark' : 'light'));
bindToggle('toggle-catchments', setCatchmentHidden);
