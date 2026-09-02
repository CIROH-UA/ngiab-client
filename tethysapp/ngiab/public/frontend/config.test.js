import { expect } from '@esm-bundle/chai';
import {
  canSeeDelete,
  getConfig,
  getPortalHost,
  getModelRunId,
  terrainUrl,
  terrainExaggeration,
} from './config.js';

describe('getConfig', () => {
  afterEach(() => {
    delete window.__NGIAB__;
  });

  it('falls back to sane defaults when window.__NGIAB__ is absent', () => {
    delete window.__NGIAB__;
    expect(getConfig().APP_ROOT_URL).to.equal('/apps/ngiab/');
    expect(getConfig().PORTAL_HOST).to.equal('');
  });

  it('reads values injected by the Django template', () => {
    window.__NGIAB__ = { APP_ROOT_URL: '/portal/apps/ngiab/', PORTAL_HOST: 'https://h' };
    expect(getConfig().APP_ROOT_URL).to.equal('/portal/apps/ngiab/');
    expect(getConfig().PORTAL_HOST).to.equal('https://h');
  });

  it('treats an empty string as absent', () => {
    window.__NGIAB__ = { APP_ROOT_URL: '', PORTAL_HOST: '' };
    expect(getConfig().APP_ROOT_URL).to.equal('/apps/ngiab/');
  });
});

describe('getPortalHost', () => {
  afterEach(() => {
    delete window.__NGIAB__;
  });

  it('uses the injected host when set', () => {
    window.__NGIAB__ = { PORTAL_HOST: 'https://portal.example.org' };
    expect(getPortalHost()).to.equal('https://portal.example.org');
  });

  it('falls back to the current origin', () => {
    delete window.__NGIAB__;
    expect(getPortalHost()).to.equal(window.location.origin);
  });
});

describe('getModelRunId', () => {
  afterEach(() => {
    delete window.__NGIAB__;
  });

  it('falls back to the template default when the URL has no param', () => {
    window.__NGIAB__ = { MODEL_RUN_ID: 'from-template' };
    expect(getModelRunId()).to.equal('from-template');
  });

  it('returns empty when neither source provides one', () => {
    delete window.__NGIAB__;
    expect(getModelRunId()).to.equal('');
  });
});

describe('terrain config', () => {
  afterEach(() => {
    delete window.__NGIAB__;
  });

  it('defaults to no terrain url and a sane exaggeration', () => {
    delete window.__NGIAB__;
    expect(terrainUrl()).to.equal('');
    expect(terrainExaggeration()).to.equal(1.4);
  });

  it('reads the terrain url and exaggeration injected by the template', () => {
    window.__NGIAB__ = { TERRAIN_URL: 'https://h/terrain.pmtiles', TERRAIN_EXAGGERATION: 2 };
    expect(terrainUrl()).to.equal('https://h/terrain.pmtiles');
    expect(terrainExaggeration()).to.equal(2);
  });

  it('falls back to the default exaggeration when the value is not a number', () => {
    window.__NGIAB__ = { TERRAIN_EXAGGERATION: 'nope' };
    expect(terrainExaggeration()).to.equal(1.4);
  });
});

describe('who may see the delete control', () => {
  const original = window.__NGIAB__;
  afterEach(() => { window.__NGIAB__ = original; });

  it('is offered to a signed-in user who holds the permission', () => {
    window.__NGIAB__ = { SIGNED_IN: true, CAN_DELETE: true };
    expect(canSeeDelete()).to.equal(true);
  });

  it('is withheld from a signed-in user without it', () => {
    window.__NGIAB__ = { SIGNED_IN: true, CAN_DELETE: false };
    expect(canSeeDelete()).to.equal(false);
  });

  it('is withheld from a guest, who cannot complete it', () => {
    window.__NGIAB__ = { SIGNED_IN: false, CAN_DELETE: false };
    expect(canSeeDelete()).to.equal(false);
  });

  it('is withheld from a guest even if the server sent a stale permission', () => {
    window.__NGIAB__ = { SIGNED_IN: false, CAN_DELETE: true };
    expect(canSeeDelete()).to.equal(false);
  });
});
