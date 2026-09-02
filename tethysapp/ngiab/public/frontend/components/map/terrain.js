export const TERRAIN_SOURCE = 'terrain-dem';

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
  map.setTerrain({ source: TERRAIN_SOURCE, exaggeration });
  return true;
}

export function removeTerrain(map) {
  if (!map) return;
  map.setTerrain(null);
}
