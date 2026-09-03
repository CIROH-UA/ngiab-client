import { LAYER_CATCHMENTS } from './layers.js';

export const TERRAIN_SOURCE = 'terrain-dem';
export const HILLSHADE_LAYER = 'terrain-hillshade';

const withProtocol = (url) => (url.startsWith('pmtiles://') ? url : `pmtiles://${url}`);

const HILLSHADE_PAINT = {
  light: {
    'hillshade-exaggeration': 0.55,
    'hillshade-shadow-color': 'rgba(58, 60, 74, 0.55)',
    'hillshade-highlight-color': 'rgba(244, 247, 252, 0.4)',
  },
  dark: {
    'hillshade-exaggeration': 0.6,
    'hillshade-shadow-color': 'rgba(6, 10, 18, 0.6)',
    'hillshade-highlight-color': 'rgba(120, 140, 170, 0.35)',
  },
};

export function applyTerrain(map, { url, exaggeration = 1.4, tileSize = 512, dark = false } = {}) {
  if (!map || !url) return false;
  if (!map.getSource(TERRAIN_SOURCE)) {
    map.addSource(TERRAIN_SOURCE, {
      type: 'raster-dem',
      url: withProtocol(url),
      encoding: 'terrarium',
      tileSize,
    });
  }
  if (!map.getLayer(HILLSHADE_LAYER)) {
    const before = map.getLayer(LAYER_CATCHMENTS) ? LAYER_CATCHMENTS : undefined;
    map.addLayer(
      {
        id: HILLSHADE_LAYER,
        type: 'hillshade',
        source: TERRAIN_SOURCE,
        paint: dark ? HILLSHADE_PAINT.dark : HILLSHADE_PAINT.light,
      },
      before,
    );
  }
  map.setTerrain({ source: TERRAIN_SOURCE, exaggeration });
  return true;
}

export function removeTerrain(map) {
  if (!map) return;
  map.setTerrain(null);
  if (map.getLayer(HILLSHADE_LAYER)) map.removeLayer(HILLSHADE_LAYER);
}
