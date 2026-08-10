/**
 * MapLibre source, layer and paint definitions for the hydrofabric.
 *
 * Every function here is pure: it takes an explicit view object and returns a plain style
 * spec. That is deliberate — these expressions are where every subtle bug in the map has
 * lived (the wrong source id, feature-id vs property lookup, a gap plotted as a value), and
 * pure functions can be tested without a browser or a live map.
 *
 * ---------------------------------------------------------------------------
 * SOURCE DATA — verified against the archives' pmtiles metadata on 2026-08-03
 *
 *   divides.pmtiles    source-layer "divides"    zoom 4-10
 *                      fields: toid, upstream_id, num_upstreams          (all Number)
 *   flowpaths.pmtiles  source-layer "flowpaths"  zoom 1-10
 *                      fields: divide_id, toid, upstream_id, order, num_upstreams
 *
 * "divides" has NO divide_id property — only toid / upstream_id / num_upstreams. The likely
 * reason is that divide_id was promoted to the vector-tile feature id (tippecanoe's
 * --use-attribute-for-id removes the attribute when it promotes it), which also explains why
 * "flowpaths" still carries divide_id but "divides" does not. Hence CATCHMENT_KEY below.
 * ---------------------------------------------------------------------------
 */

const PMTILES_BASE =
  'pmtiles://https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/only_geometry/upstream_index/';

export const STYLE_URLS = {
  light: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/light-style.json',
  dark: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json',
};

export const DIVIDES_URL = `${PMTILES_BASE}divides.pmtiles`;
export const FLOWPATHS_URL = `${PMTILES_BASE}flowpaths.pmtiles`;

/** MapLibre source ids (ours) and source-layer names inside each archive (theirs). */
export const SRC_DIVIDES = 'divides';
export const SRC_FLOWPATHS = 'flowpaths';
export const LAYER_DIVIDES = 'divides';
export const LAYER_FLOWPATHS = 'flowpaths';

/**
 * How a catchment is identified in the "divides" layer.
 *   'id'       -> the vector-tile feature id, matched with the ['id'] expression
 *   any string -> a property name, e.g. 'divide_id' or 'upstream_id'
 *
 * If catchments ever render blank, this is the first thing to change; the click handler
 * logs the raw feature id and properties so the right value is one click away.
 */
export const CATCHMENT_KEY = 'id';

/** Layers whose visibility follows `catchmentHidden`. */
export const CATCHMENT_LAYERS = ['catchments-layer', 'catchment-highlight'];
/** Layers that must stay above the catchment fill. */
export const TOP_LAYERS = ['flowpaths-layer', 'catchment-highlight'];

/**
 * @typedef {object} MapView
 * @property {'light'|'dark'} theme
 * @property {boolean} catchmentHidden
 * @property {boolean} showTeehr
 * @property {number|null} selectedCatchmentId
 * @property {number[]} catchmentIds    numeric, the run's catchments
 * @property {number[]} teehrNexusIds   numeric nexus ids that have TEEHR results
 */

const isDark = (view) => view.theme === 'dark';
const themed = (view, pair) => (isDark(view) ? pair.dark : pair.light);

/** Left-hand side of a catchment comparison: the feature id, or a property lookup. */
export const catchmentRef = () => (CATCHMENT_KEY === 'id' ? ['id'] : ['get', CATCHMENT_KEY]);

/**
 * `in` over a literal array is the modern form and evaluates far faster than the legacy
 * `['any', ['in', key, ...ids]]` the React version used with thousands of ids.
 *
 * An empty set must still produce a valid filter that matches nothing, or the layer would
 * render the whole of CONUS.
 *
 * @param {MapView} view
 */
export const catchmentSetFilter = (view) =>
  view.catchmentIds.length
    ? ['in', catchmentRef(), ['literal', view.catchmentIds]]
    : ['==', catchmentRef(), -1];

/** @param {MapView} view */
export const catchmentHighlightFilter = (view) =>
  view.selectedCatchmentId == null
    ? ['==', catchmentRef(), -1]
    : ['==', catchmentRef(), view.selectedCatchmentId];

/**
 * Flowpaths carry divide_id as a real property, so they follow the same catchment set.
 * The old flow_paths_ids payload (nexus "toid" values) is unused — flowpath and divide are
 * 1:1 in the hydrofabric, so this selects the same lines without a second id list.
 *
 * @param {MapView} view
 */
export const flowPathsFilter = (view) =>
  view.catchmentIds.length
    ? ['in', ['get', 'divide_id'], ['literal', view.catchmentIds]]
    : ['==', ['get', 'divide_id'], -1];

export const visibility = (hidden) => ({ visibility: hidden ? 'none' : 'visible' });

/*
 * TEEHR colouring.
 *
 * TEEHR results are keyed to USGS gauges, which crosswalk to *nexus* ids — there is no
 * direct catchment key. Both archives carry `toid`, the downstream nexus, so "this geometry
 * drains to a TEEHR-evaluated nexus" is expressible as a data-driven paint expression. No
 * extra layer, no extra draw pass.
 */
const TEEHR_FILL = { light: 'rgba(31, 120, 180, 0.55)', dark: 'rgba(32, 201, 151, 0.55)' };
const PLAIN_FILL = { light: 'rgba(91, 44, 111, 0.316)', dark: 'rgba(238, 51, 119, 0.316)' };
const TEEHR_LINE = { light: '#1f78b4', dark: '#20c997' };
const PLAIN_LINE = { light: '#000000', dark: '#0077bb' };

const hasTeehrNexus = (view) => ['in', ['get', 'toid'], ['literal', view.teehrNexusIds]];

/**
 * Falls back to a flat colour when there is nothing to highlight, so the expression stays
 * valid and cheap for runs with no TEEHR output.
 *
 * @param {MapView} view
 */
const teehrAware = (view, teehrColor, plainColor) =>
  view.showTeehr && view.teehrNexusIds.length
    ? ['case', hasTeehrNexus(view), themed(view, teehrColor), themed(view, plainColor)]
    : themed(view, plainColor);

/** @param {MapView} view */
export const catchmentFillColor = (view) => teehrAware(view, TEEHR_FILL, PLAIN_FILL);
/** @param {MapView} view */
export const flowPathsLineColor = (view) => teehrAware(view, TEEHR_LINE, PLAIN_LINE);

/** @param {MapView} view */
export function catchmentsSpec(view) {
  return {
    id: 'catchments-layer',
    type: 'fill',
    source: SRC_DIVIDES,
    'source-layer': LAYER_DIVIDES,
    filter: catchmentSetFilter(view),
    paint: {
      'fill-color': catchmentFillColor(view),
      'fill-outline-color': isDark(view)
        ? 'rgba(238, 51, 119, 0.7)'
        : 'rgba(91, 44, 111, 0.7)',
      'fill-opacity': { stops: [[7, 0], [11, 1]] },
    },
    layout: visibility(view.catchmentHidden),
  };
}

/** @param {MapView} view */
export function catchmentHighlightSpec(view) {
  return {
    id: 'catchment-highlight',
    type: 'fill',
    source: SRC_DIVIDES,
    'source-layer': LAYER_DIVIDES,
    filter: catchmentHighlightFilter(view),
    paint: {
      'fill-color': '#ff0000',
      'fill-outline-color': '#ffffff',
      'fill-opacity': 0.5,
    },
    layout: visibility(view.catchmentHidden),
  };
}

/** @param {MapView} view */
export function flowPathsSpec(view) {
  return {
    id: 'flowpaths-layer',
    type: 'line',
    source: SRC_FLOWPATHS,
    'source-layer': LAYER_FLOWPATHS,
    filter: flowPathsFilter(view),
    paint: {
      'line-color': flowPathsLineColor(view),
      'line-width': { stops: [[7, 1], [10, 2]] },
      'line-opacity': { stops: [[7, 0], [11, 1]] },
    },
  };
}

/**
 * Add sources and layers if absent. Idempotent, so it is safe to re-run after every
 * setStyle() — which destroys every custom source and layer.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {MapView} view
 */
export function installLayers(map, view) {
  if (!map.getSource(SRC_DIVIDES)) {
    map.addSource(SRC_DIVIDES, { type: 'vector', url: DIVIDES_URL });
  }
  if (!map.getSource(SRC_FLOWPATHS)) {
    map.addSource(SRC_FLOWPATHS, { type: 'vector', url: FLOWPATHS_URL });
  }

  for (const spec of [catchmentsSpec(view), flowPathsSpec(view), catchmentHighlightSpec(view)]) {
    if (!map.getLayer(spec.id)) map.addLayer(spec);
  }

  for (const id of TOP_LAYERS) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

/**
 * Push the current view onto layers already on the map, without rebuilding them.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {MapView} view
 */
export function refresh(map, view) {
  const setFilter = (id, filter) => {
    if (map.getLayer(id)) map.setFilter(id, filter);
  };
  const setPaint = (id, prop, value) => {
    if (map.getLayer(id)) map.setPaintProperty(id, prop, value);
  };

  setFilter('catchments-layer', catchmentSetFilter(view));
  setFilter('flowpaths-layer', flowPathsFilter(view));
  setFilter('catchment-highlight', catchmentHighlightFilter(view));

  setPaint('catchments-layer', 'fill-color', catchmentFillColor(view));
  setPaint('flowpaths-layer', 'line-color', flowPathsLineColor(view));

  for (const id of CATCHMENT_LAYERS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', view.catchmentHidden ? 'none' : 'visible');
    }
  }
}
