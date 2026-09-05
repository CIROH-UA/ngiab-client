import { expect } from '@esm-bundle/chai';
import { ChoroplethState } from './choropleth-layer.js';

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));

const fakeMap = () => {
  const calls = [];
  return {
    calls,
    getSource: () => ({}),
    setFeatureState: (target, state) => calls.push({ id: target.id, state }),
    removeFeatureState: () => {},
  };
};

const matrix = (bins, norms) => ({
  catchment_ids: [10, 20],
  times: ['t0', 't1'],
  breaks: [],
  variable: 'X',
  bins: b64(bins),
  norms: b64(norms),
});

describe('ChoroplethState value + colour state', () => {
  it('sets both the colour bin and the height value per catchment', () => {
    const map = fakeMap();
    const cs = new ChoroplethState(map);
    cs.load(matrix([1, 2, 1, 2], [100, 200, 100, 200]));
    cs.show(0);
    expect(map.calls).to.deep.equal([
      { id: 10, state: { bin: 1, val: 100 } },
      { id: 20, state: { bin: 2, val: 200 } },
    ]);
  });

  it('updates a catchment when its value changes even though the bin does not', () => {
    const map = fakeMap();
    const cs = new ChoroplethState(map);
    cs.load(matrix([1, 2, 1, 2], [100, 200, 100, 250]));
    cs.show(0);
    map.calls.length = 0;
    cs.show(1);
    expect(map.calls).to.deep.equal([{ id: 20, state: { bin: 2, val: 250 } }]);
  });
});
