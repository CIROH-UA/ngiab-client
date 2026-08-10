/**
 * Map interactions: hover, hit-testing, locating a catchment, and the tile-derived
 * catchment → nexus index.
 *
 * Everything here needs a live MapLibre instance, which is why it is separate from
 * layers.js — that module is pure and unit-tested, this one is only exercised in a browser.
 */

import { SRC_DIVIDES, LAYER_DIVIDES, CATCHMENT_KEY, catchmentRef } from './layers.js';

/**
 * Attach the pointer cursor. Call ONCE.
 *
 * Layer-scoped listeners live on the map, not the style, so they survive setStyle();
 * re-attaching after a basemap swap would silently accumulate duplicates.
 *
 * @param {import('maplibre-gl').Map} map
 */
export function attachHoverCursor(map) {
  map.on('mouseenter', 'catchments-layer', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'catchments-layer', () => {
    map.getCanvas().style.cursor = '';
  });
}

/**
 * Identify the catchment under a click, or null.
 *
 * Logs the raw feature unconditionally: that is how the CATCHMENT_KEY assumption in
 * layers.js gets confirmed against real tile data.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {{point: import('maplibre-gl').Point}} event
 * @returns {{numeric: number, nexusId: number|undefined}|null}
 */
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

/**
 * Grow a [w, s, e, n] box to include a GeoJSON coordinate array.
 * Coordinates nest arbitrarily deep (Polygon vs MultiPolygon), hence the recursion.
 *
 * @param {number[]} bounds mutated in place
 * @param {unknown} coords
 */
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

/**
 * Bounding box of a catchment, or null when it cannot be located.
 *
 * There is no per-catchment geometry on the client — getGeoSpatialData returns only the
 * run's overall bounds — so this queries the vector source and unions the matching
 * features' extent.
 *
 * Caveat: querySourceFeatures only sees tiles that are currently LOADED, so a search hit
 * outside them returns null. Callers must handle that; the highlight filter is applied
 * either way, so the feature colours in as soon as it is panned into view. The exact fix
 * would be a backend lookup returning the bbox from the geopackage.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {number} numericId
 * @returns {number[]|null} [west, south, east, north]
 */
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

/**
 * catchment → downstream nexus, harvested from whatever divide tiles are loaded.
 *
 * Built in ONE pass and cached rather than a filtered query per lookup: the search list
 * needs this for every visible row on every keystroke, and querySourceFeatures scans all
 * loaded tiles on each call. Rebuild when tile loading settles — more tiles mean more known
 * catchments.
 */
export class CatchmentNexusIndex {
  constructor() {
    /** @type {Map<number, number>} */
    this._byCatchment = new Map();
  }

  /** @param {import('maplibre-gl').Map} map */
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

  /** @param {number} numericId @returns {number|undefined} */
  nexusFor(numericId) {
    return this._byCatchment.get(numericId);
  }

  clear() {
    this._byCatchment.clear();
  }
}
