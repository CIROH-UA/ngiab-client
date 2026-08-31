import { expect } from '@esm-bundle/chai';
import './ngiab-account.js';

function mount() {
  const el = document.createElement('ngiab-account');
  document.body.append(el);
  return el;
}

const original = window.__NGIAB__;

afterEach(() => {
  window.__NGIAB__ = original;
  document.querySelectorAll('ngiab-account').forEach((node) => node.remove());
});

describe('ngiab-account when nobody is signed in', () => {
  beforeEach(() => {
    window.__NGIAB__ = { SIGNED_IN: false, LOGIN_URL: '/accounts/login/' };
  });

  it('offers a way in', () => {
    const el = mount();

    const link = el.querySelector('#account-sign-in');
    expect(link, 'no sign-in control was rendered').to.exist;
    expect(link.textContent.trim()).to.equal('Sign in');
  });

  it('comes back to the page you were on, selected run and all', () => {
    // A real URL with a query string, because the runner's own has none: without one, an
    // implementation that dropped window.location.search would still pass.
    const restore = window.location.pathname + window.location.search;
    history.pushState({}, '', '/apps/ngiab/?model_run_id=gage-07144100');
    try {
      const href = mount().querySelector('#account-sign-in').getAttribute('href');
      const next = new URL(href, window.location.origin).searchParams.get('next');
      expect(next).to.equal('/apps/ngiab/?model_run_id=gage-07144100');
    } finally {
      history.replaceState({}, '', restore);
    }
  });

  it('offers no way out, since there is nothing to leave', () => {
    expect(mount().querySelector('#account-sign-out')).to.equal(null);
  });
});

describe('ngiab-account when signed in', () => {
  beforeEach(() => {
    window.__NGIAB__ = { SIGNED_IN: true, USERNAME: 'hydro', LOGOUT_URL: '/accounts/logout/' };
  });

  it('says who you are and offers a way out', () => {
    const el = mount();

    expect(el.querySelector('.account-name').textContent).to.equal('hydro');
    expect(el.querySelector('#account-sign-out').textContent.trim()).to.equal('Sign out');
    expect(el.querySelector('#account-sign-in')).to.equal(null);
  });

  it('names the account even when the portal reports no username', () => {
    window.__NGIAB__ = { SIGNED_IN: true, USERNAME: '', LOGOUT_URL: '/accounts/logout/' };

    expect(mount().querySelector('.account-name').textContent).to.equal('your account');
  });

  it('renders a hostile username as text, never as markup', () => {
    window.__NGIAB__ = {
      SIGNED_IN: true,
      USERNAME: '<img src=x onerror="window.__accountXss=1">',
      LOGOUT_URL: '/accounts/logout/',
    };

    const el = mount();

    expect(el.querySelector('img')).to.equal(null);
    expect(window.__accountXss).to.equal(undefined);
  });
});
