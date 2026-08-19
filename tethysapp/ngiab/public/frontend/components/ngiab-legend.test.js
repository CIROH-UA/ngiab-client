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

  // A constant variable collapses to one class, where the plural read as a rendering bug.
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

  // A key to a map with nothing on it explains nothing.
  it('renders nothing at all when no run is loaded', () => {
    actions.setModelRun(null);
    el = mount();
    expect(el.innerHTML.trim()).to.equal('');
  });

  // Every mount subscribes, so a missed unsubscribe leaks a repaint per removed legend.
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
