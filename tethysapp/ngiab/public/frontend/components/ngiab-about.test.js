import { expect } from '@esm-bundle/chai';
import './ngiab-about.js';

const original = window.__NGIAB__;

function mount() {
  const el = document.createElement('ngiab-about');
  document.body.append(el);
  return el;
}

afterEach(() => {
  window.__NGIAB__ = original;
  document.querySelectorAll('ngiab-about').forEach((node) => node.remove());
});

describe('ngiab-about', () => {
  it('names the running build, which is what a support question needs first', () => {
    window.__NGIAB__ = { VERSION: '0.2.1.dev139+gb23e5dd00' };

    expect(mount().querySelector('.about-version code').textContent)
      .to.equal('0.2.1.dev139+gb23e5dd00');
  });

  it('says nothing about a version it does not know, rather than showing an empty label', () => {
    window.__NGIAB__ = { VERSION: '' };

    expect(mount().querySelector('.about-version')).to.equal(null);
  });

  it('opens its links in a new tab without handing over the opener', () => {
    window.__NGIAB__ = { VERSION: '1.0' };

    const links = [...mount().querySelectorAll('.about-links a')];

    expect(links.length).to.be.greaterThan(0);
    for (const link of links) {
      expect(link.target).to.equal('_blank');
      expect(link.rel).to.contain('noopener');
      expect(link.href).to.match(/^https:\/\//);
    }
  });

  it('stays closed until asked, so it never covers the map', () => {
    window.__NGIAB__ = { VERSION: '1.0' };

    expect(mount().querySelector('#about-panel').open).to.equal(false);
  });
});
