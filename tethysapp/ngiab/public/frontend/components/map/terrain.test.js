import { expect } from '@esm-bundle/chai';
import { applyTerrain, removeTerrain, TERRAIN_SOURCE } from './terrain.js';

const fakeMap = () => {
  const sources = new Map();
  const calls = { setTerrain: [] };
  return {
    calls,
    getSource: (id) => sources.get(id),
    addSource: (id, spec) => sources.set(id, spec),
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
});
