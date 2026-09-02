import { expect } from '@esm-bundle/chai';
import {
  LAYER_DIVIDES,
  LAYER_CATCHMENTS_EXTRUDED,
  SRC_DIVIDES,
  SRC_FLOWPATHS,
  catchmentExtrusionHeight,
  catchmentFillColor,
  catchmentHighlightFilter,
  catchmentHighlightSpec,
  catchmentSetFilter,
  catchmentsExtrudedSpec,
  catchmentsSpec,
  flowPathHighlightFilter,
  flowPathsFilter,
  flowPathsLineColor,
  flowPathsSpec,
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

  it('highlights catchment id 0', () => {
    expect(catchmentHighlightFilter(view({ selectedCatchmentId: 0 }))).to.deep.equal([
      '==', ['id'], 0,
    ]);
  });

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
    wipeStyle() {
      sources.clear();
      layers.clear();
    },
  };
}

describe('installLayers', () => {
  it('adds both sources and all five layers', () => {
    const map = fakeMap();
    installLayers(map, view());
    expect([...map.sources.keys()].sort()).to.deep.equal([SRC_DIVIDES, SRC_FLOWPATHS].sort());
    expect([...map.layers.keys()].sort()).to.deep.equal([
      'catchment-highlight',
      'catchments-extruded',
      'catchments-layer',
      'flowpath-highlight',
      'flowpaths-layer',
    ]);
  });

  it('is idempotent, so calling it on every idle is safe', () => {
    const map = fakeMap();
    installLayers(map, view());
    const first = map.layers.get('catchments-layer');
    installLayers(map, view());
    expect(map.layers.size).to.equal(5);
    expect(map.layers.get('catchments-layer')).to.equal(first);
  });

  it('restores everything after a style swap wipes it', () => {
    const map = fakeMap();
    installLayers(map, view());
    map.wipeStyle();
    expect(map.getSource(SRC_DIVIDES)).to.equal(undefined);

    installLayers(map, view({ theme: 'dark' }));
    expect(map.getSource(SRC_DIVIDES)).to.not.equal(undefined);
    expect(map.layers.size).to.equal(5);
  });
});

describe('flowPathHighlightFilter', () => {
  it('matches the flowpath draining the selected catchment', () => {
    expect(flowPathHighlightFilter({ selectedCatchmentId: 2863630 })).to.deep.equal([
      '==',
      ['get', 'divide_id'],
      2863630,
    ]);
  });

  it('matches nothing when there is no selection', () => {
    expect(flowPathHighlightFilter({ selectedCatchmentId: null })).to.deep.equal([
      '==',
      ['get', 'divide_id'],
      -1,
    ]);
  });
});

describe('extruded catchments', () => {
  it('is a fill-extrusion on the divides source, filtered to the run', () => {
    const spec = catchmentsExtrudedSpec(view({ extrude: true }));
    expect(spec.id).to.equal(LAYER_CATCHMENTS_EXTRUDED);
    expect(spec.type).to.equal('fill-extrusion');
    expect(spec.source).to.equal(SRC_DIVIDES);
    expect(spec['source-layer']).to.equal(LAYER_DIVIDES);
    expect(spec.filter).to.deep.equal(catchmentSetFilter(view()));
  });

  it('colors the prisms with the same helper as the flat catchments layer', () => {
    const plain = view();
    expect(catchmentsExtrudedSpec(plain).paint['fill-extrusion-color']).to.deep.equal(
      catchmentFillColor(plain),
    );
    const choro = view({ choropleth: true });
    expect(catchmentsExtrudedSpec(choro).paint['fill-extrusion-color']).to.deep.equal(
      catchmentFillColor(choro),
    );
  });

  it('drives height from the bin feature-state', () => {
    const height = catchmentsExtrudedSpec(view()).paint['fill-extrusion-height'];
    expect(height).to.deep.equal(catchmentExtrusionHeight());
    expect(JSON.stringify(height)).to.contain('["feature-state","bin"]');
  });

  it('is visible only in 3D mode and while catchments are shown', () => {
    expect(catchmentsExtrudedSpec(view({ extrude: true })).layout.visibility).to.equal('visible');
    expect(catchmentsExtrudedSpec(view({ extrude: false })).layout.visibility).to.equal('none');
    expect(catchmentsExtrudedSpec(view()).layout.visibility).to.equal('none');
    expect(
      catchmentsExtrudedSpec(view({ extrude: true, catchmentHidden: true })).layout.visibility,
    ).to.equal('none');
  });

  it('hides the flat fill when 3D is on', () => {
    expect(catchmentsSpec(view()).layout.visibility).to.equal('visible');
    expect(catchmentsSpec(view({ extrude: true })).layout.visibility).to.equal('none');
  });
});
