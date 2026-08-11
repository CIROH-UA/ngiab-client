import { expect } from '@esm-bundle/chai';
import {
  catchmentSetFilter,
  catchmentHighlightFilter,
  flowPathsFilter,
  catchmentFillColor,
  flowPathsLineColor,
  catchmentsSpec,
  flowPathsSpec,
  catchmentHighlightSpec,
  SRC_DIVIDES,
  SRC_FLOWPATHS,
  LAYER_DIVIDES,
  installLayers,
} from './layers.js';

const view = (over = {}) => ({
  theme: 'light',
  catchmentHidden: false,
  showTeehr: true,
  selectedCatchmentId: null,
  catchmentIds: [1, 2, 3],
  teehrNexusIds: [],
  ...over,
});

describe('filters', () => {
  it('filters catchments to the run by feature id', () => {
    expect(catchmentSetFilter(view())).to.deep.equal(['in', ['id'], ['literal', [1, 2, 3]]]);
  });

  // An empty set must match nothing: matching everything would draw all of CONUS.
  it('matches nothing when the run has no catchments', () => {
    expect(catchmentSetFilter(view({ catchmentIds: [] }))).to.deep.equal(['==', ['id'], -1]);
    expect(flowPathsFilter(view({ catchmentIds: [] }))).to.deep.equal([
      '==', ['get', 'divide_id'], -1,
    ]);
  });

  it('highlights nothing when there is no selection', () => {
    expect(catchmentHighlightFilter(view())).to.deep.equal(['==', ['id'], -1]);
  });

  it('highlights the selected catchment', () => {
    expect(catchmentHighlightFilter(view({ selectedCatchmentId: 7 }))).to.deep.equal([
      '==', ['id'], 7,
    ]);
  });

  // Catchment 0 is falsy; a truthiness check here would refuse to highlight it.
  it('highlights catchment id 0', () => {
    expect(catchmentHighlightFilter(view({ selectedCatchmentId: 0 }))).to.deep.equal([
      '==', ['id'], 0,
    ]);
  });

  // Flowpaths carry divide_id as a real property; divides do not.
  it('filters flowpaths by the divide_id property, not the feature id', () => {
    expect(flowPathsFilter(view())).to.deep.equal([
      'in', ['get', 'divide_id'], ['literal', [1, 2, 3]],
    ]);
  });
});

describe('TEEHR colouring', () => {
  it('is a flat colour when no nexus has results', () => {
    expect(catchmentFillColor(view({ teehrNexusIds: [] }))).to.be.a('string');
  });

  it('is a flat colour when the toggle is off, even with results', () => {
    expect(catchmentFillColor(view({ teehrNexusIds: [9], showTeehr: false }))).to.be.a('string');
  });

  it('becomes a case expression keyed on the downstream nexus', () => {
    const expr = catchmentFillColor(view({ teehrNexusIds: [9] }));
    expect(expr[0]).to.equal('case');
    expect(expr[1]).to.deep.equal(['in', ['get', 'toid'], ['literal', [9]]]);
  });

  it('picks different colours per theme', () => {
    const light = flowPathsLineColor(view({ teehrNexusIds: [9] }));
    const dark = flowPathsLineColor(view({ teehrNexusIds: [9], theme: 'dark' }));
    expect(light).to.not.deep.equal(dark);
  });
});

describe('layer specs', () => {
  // The React configs named a source react-map-gl silently overwrote at runtime.
  it('bind to the real source ids', () => {
    expect(catchmentsSpec(view()).source).to.equal(SRC_DIVIDES);
    expect(catchmentHighlightSpec(view()).source).to.equal(SRC_DIVIDES);
    expect(flowPathsSpec(view()).source).to.equal(SRC_FLOWPATHS);
    expect(catchmentsSpec(view())['source-layer']).to.equal(LAYER_DIVIDES);
  });

  it('carry stable layer ids', () => {
    expect(catchmentsSpec(view()).id).to.equal('catchments-layer');
    expect(flowPathsSpec(view()).id).to.equal('flowpaths-layer');
    expect(catchmentHighlightSpec(view()).id).to.equal('catchment-highlight');
  });

  it('hide both catchment layers together', () => {
    const hidden = view({ catchmentHidden: true });
    expect(catchmentsSpec(hidden).layout.visibility).to.equal('none');
    expect(catchmentHighlightSpec(hidden).layout.visibility).to.equal('none');
  });
});

// Minimal stand-in for a MapLibre map: enough to observe what installLayers adds.
function fakeMap() {
  const sources = new Map();
  const layers = new Map();
  return {
    sources,
    layers,
    addSource: (id, spec) => sources.set(id, spec),
    getSource: (id) => sources.get(id),
    addLayer: (spec) => layers.set(spec.id, spec),
    getLayer: (id) => layers.get(id),
    moveLayer: () => {},
    setFilter: () => {},
    setPaintProperty: () => {},
    setLayoutProperty: () => {},
    // What setStyle() does to everything we added.
    wipeStyle() {
      sources.clear();
      layers.clear();
    },
  };
}

describe('installLayers', () => {
  it('adds both sources and all three layers', () => {
    const map = fakeMap();
    installLayers(map, view());
    expect([...map.sources.keys()].sort()).to.deep.equal([SRC_DIVIDES, SRC_FLOWPATHS].sort());
    expect([...map.layers.keys()].sort()).to.deep.equal(
      ['catchment-highlight', 'catchments-layer', 'flowpaths-layer'],
    );
  });

  it('is idempotent, so calling it on every idle is safe', () => {
    const map = fakeMap();
    installLayers(map, view());
    const first = map.layers.get('catchments-layer');
    installLayers(map, view());
    expect(map.layers.size).to.equal(3);
    expect(map.layers.get('catchments-layer')).to.equal(first);
  });

  // The dark-mode regression: setStyle wipes everything, and the reinstall has to put it
  // back. Guarding the reinstall on an event that never reports a loaded style left the map
  // permanently empty after a theme swap.
  it('restores everything after a style swap wipes it', () => {
    const map = fakeMap();
    installLayers(map, view());
    map.wipeStyle();
    expect(map.getSource(SRC_DIVIDES)).to.equal(undefined);

    installLayers(map, view({ theme: 'dark' }));
    expect(map.getSource(SRC_DIVIDES)).to.not.equal(undefined);
    expect(map.layers.size).to.equal(3);
  });
});
