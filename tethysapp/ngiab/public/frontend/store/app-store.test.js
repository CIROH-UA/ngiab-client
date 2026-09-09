import { expect } from '@esm-bundle/chai';
import { store, actions } from './app-store.js';

beforeEach(() => {
  actions.setModelRun('run-1');
  actions.setTheme('light');
});

it('starts with the documented shape', () => {
  const s = store.get();
  expect(s).to.have.property('selection');
  expect(s.selection).to.have.all.keys('type', 'id', 'label');
  expect(s.layers).to.have.all.keys('catchmentHidden', 'showTeehr', 'extrude', 'terrain');
  expect(s.theme).to.be.oneOf(['light', 'dark']);
});

it('defaults the 3D and terrain layer toggles to off', () => {
  expect(store.get().layers.extrude).to.equal(false);
  expect(store.get().layers.terrain).to.equal(false);
});

it('setLayer toggles the extrude flag without disturbing other layers', () => {
  actions.setLayer('extrude', true);
  expect(store.get().layers.extrude).to.equal(true);
  expect(store.get().layers.showTeehr).to.equal(true);
  actions.setLayer('extrude', false);
  expect(store.get().layers.extrude).to.equal(false);
});

it('setLayer toggles the terrain flag', () => {
  actions.setLayer('terrain', true);
  expect(store.get().layers.terrain).to.equal(true);
  actions.setLayer('terrain', false);
  expect(store.get().layers.terrain).to.equal(false);
});

it('selectCatchment records the selection and derived ids', () => {
  actions.selectCatchment({ id: 1015, label: 'cat-1015', teehrId: 'usgs-02464000' });
  const s = store.get();
  expect(s.selection).to.deep.equal({ type: 'catchment', id: 1015, label: 'cat-1015' });
  expect(s.teehrId).to.equal('usgs-02464000');
  expect(s.trouteId).to.equal(1015); // defaults to the catchment id
});

it('selectCatchment defaults the label and clears teehr when absent', () => {
  actions.selectCatchment({ id: 42 });
  const s = store.get();
  expect(s.selection.label).to.equal('42');
  expect(s.teehrId).to.equal(null);
});

describe('choropleth state', () => {
  beforeEach(() => {
    actions.setMapVariable('Q_OUT');
    actions.setFrameCount(10);
  });

  it('clamps a frame request to the available range', () => {
    actions.setFrame(99);
    expect(store.get().frameIndex).to.equal(9);
    actions.setFrame(-5);
    expect(store.get().frameIndex).to.equal(0);
  });

  it('wraps when stepping past either end so playback loops', () => {
    actions.setFrame(9);
    actions.stepFrame(1);
    expect(store.get().frameIndex).to.equal(0);
    actions.stepFrame(-1);
    expect(store.get().frameIndex).to.equal(9);
  });

  it('pulls the frame back when a new run has fewer frames', () => {
    actions.setFrame(9);
    actions.setFrameCount(3);
    expect(store.get().frameIndex).to.equal(2);
  });

  it('refuses to play a run with nothing to animate', () => {
    actions.setFrameCount(1);
    actions.setPlaying(true);
    expect(store.get().playing).to.equal(false);
  });

  it('drops the choropleth entirely when the run changes', () => {
    actions.setFrame(5);
    actions.setPlaying(true);
    actions.setModelRun('run-2');
    const s = store.get();
    expect(s.mapVariable).to.equal(null);
    expect(s.frameIndex).to.equal(0);
    expect(s.frameCount).to.equal(0);
    expect(s.playing).to.equal(false);
  });

  it('resets the timeline when the variable changes', () => {
    actions.setFrame(7);
    actions.setMapVariable('RAIN_RATE');
    expect(store.get().frameIndex).to.equal(0);
    expect(store.get().playing).to.equal(false);
  });
});

it('selecting a new catchment clears the chosen variables', () => {
  actions.selectCatchment({ id: 1 });
  actions.setVariable('streamflow');
  actions.setTeehrVariable('ngen_ngiab-streamflow_hourly_inst');
  actions.selectCatchment({ id: 2 });
  expect(store.get().variable).to.equal(null);
  expect(store.get().teehrVariable).to.equal(null);
});

it('changing the model run clears the selection', () => {
  actions.selectCatchment({ id: 7, teehrId: 'usgs-1' });
  actions.setModelRun('run-2');
  const s = store.get();
  expect(s.modelRunId).to.equal('run-2');
  expect(s.selection.id).to.equal(null);
  expect(s.teehrId).to.equal(null);
});

it('clearSelection resets selection and derived ids', () => {
  actions.selectCatchment({ id: 9, teehrId: 'usgs-2' });
  actions.clearSelection();
  expect(store.get().selection.type).to.equal(null);
  expect(store.get().trouteId).to.equal(null);
});

it('setTheme changes only the theme', () => {
  actions.selectCatchment({ id: 3 });
  actions.setTheme('dark');
  expect(store.get().theme).to.equal('dark');
  expect(store.get().selection.id).to.equal(3);
});

it('setLayer patches one layer flag without dropping the others', () => {
  actions.setLayer('showTeehr', false);
  actions.setLayer('catchmentHidden', true);
  expect(store.get().layers).to.deep.equal({
    catchmentHidden: true,
    showTeehr: false,
    extrude: false,
    terrain: false,
  });
  actions.setLayer('catchmentHidden', false);
  actions.setLayer('showTeehr', true);
});

it('notifies subscribers on action-driven changes', () => {
  let seen = 0;
  const off = store.subscribe(() => { seen += 1; });
  actions.setTheme('dark');
  actions.setTheme('light');
  off();
  expect(seen).to.equal(2);
});
