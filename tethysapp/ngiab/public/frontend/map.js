// Vanilla MapLibre port of reactapp/features/Map/components/mapgl.js
//
// Spike scope: module-local state and plain fetch, so this file depends on nothing from the
// Phase 0 scaffold. When it becomes <ngiab-map>, `state` turns into store subscriptions and
// onSelect() turns into store actions; the layer specs, install/refresh, and click handling
// port across unchanged.
//
// See docs/superpowers/plans/2026-08-03-map-spike-plan.md for what react-map-gl was doing
// implicitly. The short version:
//   1. The React layer configs say source:'hydrofabric', but react-map-gl overwrites that with
//      the parent <Source id="conus">. 'conus' is the real id.
//   2. setStyle() destroys every custom source and layer, so installLayers() is idempotent and
//      re-runs after each style swap.
//   3. `cluster` is a source construction option, so toggling it rebuilds the source.
//   4. addSource() rejects data:null, so the geojson source is seeded with an empty
//      FeatureCollection.

import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STYLE_URLS = {
  light: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/light-style.json',
  dark: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json',
};
const PMTILES_URL =
  'pmtiles://https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/merged.pmtiles';

const SRC_CONUS = 'conus';
const SRC_NEXUS = 'nexus-points';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// Layers this module owns. NEXUS_LAYERS is also the teardown list for the cluster toggle.
const NEXUS_LAYERS = [
  'all-points',
  'clusters',
  'cluster-count',
  'unclustered-point',
  'nexus-highlight',
];
// Layers whose visibility follows state.catchmentHidden.
const CATCHMENT_LAYERS = ['catchments-layer', 'catchment-highlight'];
// Layers that must stay above the CONUS fills, in back-to-front order.
const TOP_LAYERS = [
  'clusters',
  'unclustered-point',
  'cluster-count',
  'all-points',
  'nexus-highlight',
  'catchment-highlight',
];

// ---------------------------------------------------------------------------
// State — becomes the global store in <ngiab-map>
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

// Global, not per-map. The React version registered this inside a useEffect keyed on
// [theme, base_model_id], so it re-registered on every theme and model-run change.
maplibregl.addProtocol('pmtiles', new Protocol({ metadata: true }).tile);

// ---------------------------------------------------------------------------
// Layer specs — the useMemo blocks as plain functions of state
// ---------------------------------------------------------------------------

// Legacy 'in' filter, matching the React version. An empty id list still has to produce a
// filter that matches nothing, or the layer would render all of CONUS.
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

function catchmentHighlightFilter() {
  return ['==', ['get', 'divide_id'], state.selectedCatchmentId ?? ''];
}

function catchmentHighlightSpec() {
  return {
    id: 'catchment-highlight',
    type: 'fill',
    source: SRC_CONUS,
    'source-layer': 'conus_divides',
    filter: catchmentHighlightFilter(),
    paint: {
      'fill-color': '#ff0000',
      'fill-outline-color': '#ffffff',
      'fill-opacity': 0.5,
    },
    layout: visibility(state.catchmentHidden),
  };
}

function nexusHighlightFilter() {
  return state.selectedNexusId
    ? ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], state.selectedNexusId]]
    : ['==', ['get', 'id'], ''];
}

function nexusHighlightSpec() {
  return {
    id: 'nexus-highlight',
    type: 'circle',
    source: SRC_NEXUS,
    filter: nexusHighlightFilter(),
    paint: {
      'circle-radius': 10,
      'circle-stroke-width': 3,
      'circle-stroke-color': '#ffffff',
      'circle-color': '#ff0000',
    },
  };
}

// Clustered mode gets three layers, unclustered gets one. Highlight is added in both cases.
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

// ---------------------------------------------------------------------------
// Install — idempotent, so it is safe to re-run after every setStyle()
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
    map.addSource(SRC_NEXUS, {
      type: 'geojson',
      data: state.nexusPoints, // never null — seeded with EMPTY_FC
      cluster: state.clustered,
      clusterRadius: 50,
      clusterMaxZoom: 14,
    });
  }
  // The React nexusLayers memo returned null when hidden, so no layers existed at all.
  if (state.nexusHidden) return;
  for (const spec of nexusSpecs()) addLayerIfMissing(map, spec);
}

function installLayers(map) {
  installConus(map);
  installNexus(map);
  // Keep points and highlights above the fills, as onMapLoad did with moveLayer.
  for (const id of TOP_LAYERS) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

// Layers must come off before the source, or MapLibre errors on the dangling reference.
function teardownNexus(map) {
  for (const id of NEXUS_LAYERS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SRC_NEXUS)) map.removeSource(SRC_NEXUS);
}

// ---------------------------------------------------------------------------
// Refresh — push state onto layers already on the map, without rebuilding them
// ---------------------------------------------------------------------------
function setFilterIfPresent(map, id, filter) {
  if (map.getLayer(id)) map.setFilter(id, filter);
}

function refresh(map) {
  const nexusSource = map.getSource(SRC_NEXUS);
  if (nexusSource) nexusSource.setData(state.nexusPoints);

  setFilterIfPresent(map, 'catchments-layer', inFilter('divide_id', state.catchmentIds));
  setFilterIfPresent(map, 'flowpaths-layer', inFilter('id', state.flowPathIds));
  setFilterIfPresent(map, 'gauges-layer', inFilter('nex_id', state.nexusIds));
  setFilterIfPresent(map, 'catchment-highlight', catchmentHighlightFilter());
  setFilterIfPresent(map, 'nexus-highlight', nexusHighlightFilter());

  for (const id of CATCHMENT_LAYERS) {
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

// Attach ONCE. Layer-scoped listeners live on the map, not the style, so they survive
// setStyle() — re-attaching after a style swap would just accumulate duplicates.
function attachHoverCursor(map) {
  for (const layer of ['catchments-layer', 'unclustered-point', 'clusters', 'all-points']) {
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = '';
    });
  }
}

async function handleClick(map, event) {
  // Query only what is currently visible, exactly as the React handler did.
  const wanted = [];
  if (!state.nexusHidden) {
    wanted.push(state.clustered ? 'unclustered-point' : 'all-points');
    if (state.clustered) wanted.push('clusters');
  }
  if (!state.catchmentHidden) wanted.push('catchments-layer');

  const layers = wanted.filter((id) => map.getLayer(id));
  if (!layers.length) return;

  const features = map.queryRenderedFeatures(event.point, { layers });
  if (!features || !features.length) return;

  for (const feature of features) {
    const layerId = feature.layer.id;

    if (layerId === 'all-points' || layerId === 'unclustered-point') {
      const nexusId = feature.properties.id;
      state.selectedNexusId = nexusId;
      state.selectedCatchmentId = null;
      const ngenUsgs = feature.properties.ngen_usgs;
      onSelect({
        type: 'nexus',
        id: nexusId,
        trouteId: nexusId,
        teehrId: ngenUsgs && ngenUsgs !== 'none' ? ngenUsgs : null,
      });
      refresh(map);
      return;
    }

    if (layerId === 'clusters') {
      // GeoJSONSource cluster methods return promises in MapLibre GL JS v4.
      const zoom = await map
        .getSource(SRC_NEXUS)
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

  state.nexusPoints = body.nexus ?? EMPTY_FC;
  state.catchmentIds = body.catchments ?? [];
  state.flowPathIds = body.flow_paths_ids ?? [];
  state.nexusIds = body.nexus_ids ?? [];
  state.selectedNexusId = null;
  state.selectedCatchmentId = null;

  refresh(map);

  // bounds is a flat [west, south, east, north] from gdf.total_bounds.tolist().
  if (body.bounds) map.fitBounds(body.bounds, { padding: 20, duration: 1000 });

  const nexusCount = state.nexusPoints.features?.length ?? 0;
  setStatus(`${modelRunId}: ${nexusCount} nexus, ${state.catchmentIds.length} catchments`);
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

map.on('click', (event) => {
  handleClick(map, event).catch((error) => console.error('[map] click failed', error));
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

// `cluster` is a source construction option, so the source has to be rebuilt.
function setClustered(clustered) {
  state.clustered = clustered;
  teardownNexus(map);
  installLayers(map);
  refresh(map);
}

function setNexusHidden(hidden) {
  state.nexusHidden = hidden;
  // Unhiding has to re-add layers that installNexus skipped while hidden.
  if (!hidden) installLayers(map);
  refresh(map);
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
bindToggle('toggle-cluster', setClustered);
bindToggle('toggle-nexus', setNexusHidden);
bindToggle('toggle-catchments', setCatchmentHidden);
