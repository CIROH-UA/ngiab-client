import { expect } from '@esm-bundle/chai';
import { store, actions } from './app-store.js';

// The store is a shared singleton, so each case sets what it depends on.
beforeEach(() => {
  actions.setModelRun('run-1');
  actions.setTheme('light');
});

it('starts with the documented shape', () => {
  const s = store.get();
  expect(s).to.have.property('selection');
  expect(s.selection).to.have.all.keys('type', 'id', 'label');
  expect(s.layers).to.have.all.keys('catchmentHidden', 'showTeehr');
  expect(s.theme).to.be.oneOf(['light', 'dark']);
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

// The old variable may not exist on the new feature, so selecting must reset it.
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

// layers is nested, so a naive store.set({layers:{...}}) would drop sibling keys.
it('setLayer patches one layer flag without dropping the others', () => {
  actions.setLayer('showTeehr', false);
  actions.setLayer('catchmentHidden', true);
  expect(store.get().layers).to.deep.equal({ catchmentHidden: true, showTeehr: false });
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
