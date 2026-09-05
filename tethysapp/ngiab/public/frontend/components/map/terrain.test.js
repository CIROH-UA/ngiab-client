import { expect } from '@esm-bundle/chai';
import { applyTerrain, removeTerrain, TERRAIN_SOURCE, HILLSHADE_LAYER } from './terrain.js';

const fakeMap = () => {
  const sources = new Map();
  const layers = new Map();
  const calls = { setTerrain: [] };
  return {
    calls,
    getSource: (id) => sources.get(id),
    addSource: (id, spec) => sources.set(id, spec),
    getLayer: (id) => layers.get(id),
    addLayer: (spec) => layers.set(spec.id, spec),
    removeLayer: (id) => layers.delete(id),
    setTerrain: (arg) => calls.setTerrain.push(arg),
  };
};

describe('terrain', () => {
  it('adds a terrarium raster-dem source and enables terrain', () => {
    const map = fakeMap();
    const ok = applyTerrain(map, { url: 'https://x/terrain.pmtiles', exaggeration: 1.5 });
    expect(ok).to.equal(true);
    const src = map.getSource(TERRAIN_SOURCE);
    expect(src.type).to.equal('raster-dem');
    expect(src.encoding).to.equal('terrarium');
    expect(src.url).to.equal('pmtiles://https://x/terrain.pmtiles');
    expect(map.calls.setTerrain.at(-1)).to.deep.equal({
      source: TERRAIN_SOURCE,
      exaggeration: 1.5,
    });
  });

  it('does not double-prefix a url that already carries the pmtiles protocol', () => {
    const map = fakeMap();
    applyTerrain(map, { url: 'pmtiles://https://x/t.pmtiles' });
    expect(map.getSource(TERRAIN_SOURCE).url).to.equal('pmtiles://https://x/t.pmtiles');
  });

  it('is a no-op when no url is configured', () => {
    const map = fakeMap();
    const ok = applyTerrain(map, { url: '' });
    expect(ok).to.equal(false);
    expect(map.getSource(TERRAIN_SOURCE)).to.equal(undefined);
    expect(map.calls.setTerrain).to.have.length(0);
  });

  it('does not re-add the source on a second apply', () => {
    const map = fakeMap();
    applyTerrain(map, { url: 'https://x/t.pmtiles' });
    const first = map.getSource(TERRAIN_SOURCE);
    applyTerrain(map, { url: 'https://x/t.pmtiles' });
    expect(map.getSource(TERRAIN_SOURCE)).to.equal(first);
    expect(map.calls.setTerrain).to.have.length(2);
  });

  it('removeTerrain clears the terrain', () => {
    const map = fakeMap();
    removeTerrain(map);
    expect(map.calls.setTerrain.at(-1)).to.equal(null);
  });

  it('adds a hillshade layer with terrain and removes it on teardown', () => {
    const map = fakeMap();
    applyTerrain(map, { url: 'https://x/t.pmtiles' });
    expect(map.getLayer(HILLSHADE_LAYER).type).to.equal('hillshade');
    expect(map.getLayer(HILLSHADE_LAYER).source).to.equal(TERRAIN_SOURCE);
    removeTerrain(map);
    expect(map.getLayer(HILLSHADE_LAYER)).to.equal(undefined);
  });

  it('shades the hillshade to match the active theme', () => {
    const light = fakeMap();
    applyTerrain(light, { url: 'https://x/t.pmtiles', dark: false });
    const dark = fakeMap();
    applyTerrain(dark, { url: 'https://x/t.pmtiles', dark: true });
    expect(dark.getLayer(HILLSHADE_LAYER).paint).to.not.deep.equal(
      light.getLayer(HILLSHADE_LAYER).paint,
    );
  });
});
