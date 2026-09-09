import { expect } from '@esm-bundle/chai';
import './ngiab-chart.js';

function mount() {
  const el = document.createElement('ngiab-chart');
  document.body.append(el);
  return el;
}

describe('ngiab-chart note', () => {
  let el;

  afterEach(() => el?.remove());

  it('shows the note a payload carries', () => {
    el = mount();
    el._renderPayload({
      note: 'Channel routing along flowpath wb-2863630, which drains cat-2863630.',
      data: [],
    });

    const note = el.querySelector('#chart-note');
    expect(note.hidden).to.equal(false);
    expect(note.textContent).to.contain('wb-2863630');
  });

  it('hides the note again for a payload without one', () => {
    el = mount();
    el._renderPayload({ note: 'something', data: [] });
    el._renderPayload({ data: [] });

    expect(el.querySelector('#chart-note').hidden).to.equal(true);
  });

  it('starts with no note', () => {
    el = mount();
    expect(el.querySelector('#chart-note').hidden).to.equal(true);
  });
});
