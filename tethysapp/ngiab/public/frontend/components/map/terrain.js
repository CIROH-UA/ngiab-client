export const TERRAIN_SOURCE = 'terrain-dem';
export const HILLSHADE_LAYER = 'terrain-hillshade';

const withProtocol = (url) => (url.startsWith('pmtiles://') ? url : `pmtiles://${url}`);

export function applyTerrain(map, { url, exaggeration = 1.4, tileSize = 512 } = {}) {
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
    const before = map.getLayer('catchments-layer') ? 'catchments-layer' : undefined;
    map.addLayer(
      {
        id: HILLSHADE_LAYER,
        type: 'hillshade',
        source: TERRAIN_SOURCE,
        paint: {
          'hillshade-exaggeration': 0.55,
          'hillshade-shadow-color': 'rgba(60, 60, 70, 0.55)',
          'hillshade-highlight-color': 'rgba(255, 255, 255, 0.4)',
        },
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
