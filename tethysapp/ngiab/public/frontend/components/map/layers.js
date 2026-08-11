import { RAMP, NO_DATA_BIN } from '../../lib/choropleth.js';

const PMTILES_BASE =
  'pmtiles://https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/only_geometry/upstream_index/';

export const STYLE_URLS = {
  light: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/light-style.json',
  dark: 'https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json',
};

export const DIVIDES_URL = `${PMTILES_BASE}divides.pmtiles`;
export const FLOWPATHS_URL = `${PMTILES_BASE}flowpaths.pmtiles`;

export const SRC_DIVIDES = 'divides';
export const SRC_FLOWPATHS = 'flowpaths';
export const LAYER_DIVIDES = 'divides';
export const LAYER_FLOWPATHS = 'flowpaths';

export const CATCHMENT_KEY = 'id';

export const CATCHMENT_LAYERS = ['catchments-layer', 'catchment-highlight'];
export const TOP_LAYERS = ['flowpaths-layer', 'catchment-highlight'];

const isDark = (view) => view.theme === 'dark';
const themed = (view, pair) => (isDark(view) ? pair.dark : pair.light);

export const catchmentRef = () => (CATCHMENT_KEY === 'id' ? ['id'] : ['get', CATCHMENT_KEY]);

export const catchmentSetFilter = (view) =>
  view.catchmentIds.length
    ? ['in', catchmentRef(), ['literal', view.catchmentIds]]
    : ['==', catchmentRef(), -1];

export const catchmentHighlightFilter = (view) =>
  view.selectedCatchmentId == null
    ? ['==', catchmentRef(), -1]
    : ['==', catchmentRef(), view.selectedCatchmentId];

export const flowPathsFilter = (view) =>
  view.catchmentIds.length
    ? ['in', ['get', 'divide_id'], ['literal', view.catchmentIds]]
    : ['==', ['get', 'divide_id'], -1];

export const visibility = (hidden) => ({ visibility: hidden ? 'none' : 'visible' });

const TEEHR_FILL = { light: 'rgba(31, 120, 180, 0.55)', dark: 'rgba(32, 201, 151, 0.55)' };
const PLAIN_FILL = { light: 'rgba(91, 44, 111, 0.316)', dark: 'rgba(238, 51, 119, 0.316)' };
const TEEHR_LINE = { light: '#1f78b4', dark: '#20c997' };
const PLAIN_LINE = { light: '#000000', dark: '#0077bb' };

const hasTeehrNexus = (view) => ['in', ['get', 'toid'], ['literal', view.teehrNexusIds]];

const teehrAware = (view, teehrColor, plainColor) =>
  view.showTeehr && view.teehrNexusIds.length
    ? ['case', hasTeehrNexus(view), themed(view, teehrColor), themed(view, plainColor)]
    : themed(view, plainColor);

// Feature-state, not a filter: the bin changes every frame. See README.
export const choroplethFillColor = (view) => {
  const ramp = RAMP[view.theme === 'dark' ? 'dark' : 'light'];
  const cases = [];
  for (let bin = 1; bin < ramp.length; bin += 1) cases.push(bin, ramp[bin]);
  return ['match', ['coalesce', ['feature-state', 'bin'], NO_DATA_BIN], ...cases, ramp[0]];
};

export const catchmentFillColor = (view) =>
  view.choropleth ? choroplethFillColor(view) : teehrAware(view, TEEHR_FILL, PLAIN_FILL);
export const flowPathsLineColor = (view) => teehrAware(view, TEEHR_LINE, PLAIN_LINE);

// Choropleth mode stays visible far below zoom 11, where the default ramp fades out.
export const catchmentFillOpacity = (view) =>
  view.choropleth ? { stops: [[4, 0.85], [9, 0.9]] } : { stops: [[7, 0], [11, 1]] };

export const catchmentOutlineColor = (view) => {
  if (view.choropleth) return isDark(view) ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';
  return isDark(view) ? 'rgba(238, 51, 119, 0.7)' : 'rgba(91, 44, 111, 0.7)';
};

export function catchmentsSpec(view) {
  return {
    id: 'catchments-layer',
    type: 'fill',
    source: SRC_DIVIDES,
    'source-layer': LAYER_DIVIDES,
    filter: catchmentSetFilter(view),
    paint: {
      'fill-color': catchmentFillColor(view),
      'fill-outline-color': catchmentOutlineColor(view),
      'fill-opacity': catchmentFillOpacity(view),
    },
    layout: visibility(view.catchmentHidden),
  };
}

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
  setPaint('catchments-layer', 'fill-outline-color', catchmentOutlineColor(view));
  setPaint('catchments-layer', 'fill-opacity', catchmentFillOpacity(view));
  setPaint('flowpaths-layer', 'line-color', flowPathsLineColor(view));

  for (const id of CATCHMENT_LAYERS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', view.catchmentHidden ? 'none' : 'visible');
    }
  }
}
