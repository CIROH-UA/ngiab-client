import maplibregl from 'maplibre-gl';

import { SRC_DIVIDES, LAYER_DIVIDES, CATCHMENT_KEY, catchmentRef } from './layers.js';

export function attachHoverCursor(map) {
  map.on('mouseenter', 'catchments-layer', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'catchments-layer', () => {
    map.getCanvas().style.cursor = '';
  });
}

export const featureCatchmentId = (feature) =>
  (CATCHMENT_KEY === 'id' ? feature?.id : feature?.properties?.[CATCHMENT_KEY]);

export function attachMapTip(map, describe) {
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 10,
    className: 'map-tip',
  });

  map.on('mousemove', 'catchments-layer', (event) => {
    const numeric = featureCatchmentId(event.features?.[0]);
    if (numeric == null) return;

    const html = describe(numeric);
    if (!html) {
      popup.remove();
      return;
    }
    popup.setLngLat(event.lngLat).setHTML(html).addTo(map);
  });

  map.on('mouseleave', 'catchments-layer', () => popup.remove());
  return popup;
}

export function catchmentAtPoint(map, event) {
  if (!map.getLayer('catchments-layer')) return null;

  const features = map.queryRenderedFeatures(event.point, { layers: ['catchments-layer'] });
  if (!features?.length) return null;

  const feature = features[0];
  console.log('[map] catchment feature', { id: feature.id, properties: feature.properties });

  const numeric = CATCHMENT_KEY === 'id' ? feature.id : feature.properties?.[CATCHMENT_KEY];
  if (numeric == null) {
    console.warn(`[map] no "${CATCHMENT_KEY}" on the clicked feature — check CATCHMENT_KEY`);
    return null;
  }

  return { numeric, nexusId: feature.properties?.toid };
}

function extendBounds(bounds, coords) {
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

export function catchmentBounds(map, numericId) {
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

export class CatchmentNexusIndex {
  constructor() {
    this._byCatchment = new Map();
  }

  reindex(map) {
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
      if (key !== undefined && toid !== undefined) this._byCatchment.set(key, toid);
    }
  }

  nexusFor(numericId) {
    return this._byCatchment.get(numericId);
  }

  clear() {
    this._byCatchment.clear();
  }
}
