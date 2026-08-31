import { expect } from '@esm-bundle/chai';
import { actions } from '../store/app-store.js';
import './ngiab-legend.js';

function mount() {
  const el = document.createElement('ngiab-legend');
  document.body.append(el);
  return el;
}

describe('ngiab-legend', () => {
  let el;

  beforeEach(() => actions.setModelRun('11111111-2222-3333-4444-555555555555'));

  afterEach(() => {
    el?.remove();
    actions.setMapVariable(null);
    actions.setModelRun(null);
  });

  it('names the shaded variable and both ends of the ramp', () => {
    actions.setMapVariable('SOIL_STORAGE');
    el = mount();
    el.setScale({ variable: 'SOIL_STORAGE', breaks: [0.05, 0.068] });

    expect(el.querySelector('.legend-title').textContent).to.equal('SOIL_STORAGE');
    expect(el.querySelectorAll('.legend-ramp .seg')).to.have.length(3);
    expect(el.querySelector('.legend-note').textContent).to.contain('3 quantile classes');
  });

  it('explains a single class instead of printing "1 quantile classes"', () => {
    actions.setMapVariable('SOIL_TO_GW_FLUX');
    el = mount();
    el.setScale({ variable: 'SOIL_TO_GW_FLUX', breaks: [] });

    const note = el.querySelector('.legend-note').textContent;
    expect(note).to.not.contain('1 quantile classes');
    expect(note).to.contain('constant');
  });

  it('falls back to the layer swatches when nothing is shaded', () => {
    el = mount();
    expect(el.querySelector('.legend-ramp')).to.equal(null);
    expect(el.querySelectorAll('.legend-scale li').length).to.be.greaterThan(0);
  });

  it('renders nothing at all when no run is loaded', () => {
    actions.setModelRun(null);
    el = mount();
    expect(el.innerHTML.trim()).to.equal('');
  });

  it('stops repainting from the store once removed', () => {
    actions.setMapVariable('SOIL_STORAGE');
    el = mount();
    el.setScale({ variable: 'SOIL_STORAGE', breaks: [0.05, 0.068] });
    el.remove();

    const painted = el.innerHTML;
    actions.setTheme('dark');
    try {
      expect(el.innerHTML).to.equal(painted);
    } finally {
      actions.setTheme('light');
    }
  });
});

describe('ngiab-legend and hostile run content', () => {
  // A variable name is a column header out of the run's own output files, so an uploaded run
  // chooses it. The title used to be interpolated into innerHTML, which made that header
  // executable in every viewer's session on an open portal.
  const HOSTILE = '"><img src=x onerror="window.__legendXss=1">';

  afterEach(() => {
    delete window.__legendXss;
    actions.setMapVariable(null);
    actions.setModelRun(null);
    document.querySelectorAll('ngiab-legend').forEach((node) => node.remove());
  });

  it('renders a variable name as text, never as markup', async () => {
    actions.setModelRun('11111111-2222-3333-4444-555555555555');
    actions.setMapVariable(HOSTILE);
    const el = document.createElement('ngiab-legend');
    document.body.append(el);
    el.setScale({ variable: HOSTILE, breaks: [0.05, 0.068] });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(el.querySelector('img')).to.equal(null);
    expect(window.__legendXss).to.equal(undefined);
    expect(el.querySelector('.legend-title').textContent).to.equal(HOSTILE);
  });
});
