import { expect } from '@esm-bundle/chai';
import { getConfig, getPortalHost, getModelRunId } from './config.js';

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

  // Django renders '' for a missing key, so empty must behave as absent.
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
