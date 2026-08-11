import { expect } from '@esm-bundle/chai';
import appAPI from './app.js';
import { getJSON, ApiError } from './client.js';

// Stub fetch, not the client, so URL building and response handling both run.
function withStubbedFetch(handler, run) {
  const original = window.fetch;
  const calls = [];
  window.fetch = (input, init) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(handler(String(input)));
  };
  return Promise.resolve(run(calls)).finally(() => {
    window.fetch = original;
  });
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  window.__NGIAB__ = { APP_ROOT_URL: '/apps/ngiab/', PORTAL_HOST: '' };
});

afterEach(() => {
  delete window.__NGIAB__;
});

it('builds endpoint URLs from APP_ROOT_URL and forwards params', () =>
  withStubbedFetch(
    () => jsonResponse({ ok: true }),
    async (calls) => {
      await appAPI.getGeoSpatialData({ model_run_id: 'run-1' });
      const url = new URL(calls[0].url);
      expect(url.pathname).to.equal('/apps/ngiab/getGeoSpatialData/');
      expect(url.searchParams.get('model_run_id')).to.equal('run-1');
    },
  ));

it('honours a non-default APP_ROOT_URL', () =>
  withStubbedFetch(
    () => jsonResponse({ ok: true }),
    async (calls) => {
      window.__NGIAB__ = { APP_ROOT_URL: '/portal/apps/ngiab/' };
      await appAPI.getTeehrLocations({ model_run_id: 'r' });
      expect(new URL(calls[0].url).pathname).to.equal('/portal/apps/ngiab/getTeehrLocations/');
    },
  ));

it('omits empty params rather than sending blanks', () =>
  withStubbedFetch(
    () => jsonResponse({ ok: true }),
    async (calls) => {
      await appAPI.getCatchmentTimeSeries({ catchment_id: 'cat-1', variable_column: null });
      const url = new URL(calls[0].url);
      expect(url.searchParams.get('catchment_id')).to.equal('cat-1');
      expect(url.searchParams.has('variable_column')).to.equal(false);
    },
  ));

// Some controllers report failure as HTTP 200 plus an 'error' key.
it('raises on an error key returned with HTTP 200', () =>
  withStubbedFetch(
    () => jsonResponse({ error: 'Failed to read GeoPackage file.' }),
    async () => {
      let caught = null;
      try {
        await appAPI.getGeoSpatialData({ model_run_id: 'bad' });
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ApiError);
      expect(caught.message).to.equal('Failed to read GeoPackage file.');
    },
  ));

it('raises on a non-ok status', () =>
  withStubbedFetch(
    () => jsonResponse({}, 500),
    async () => {
      let caught = null;
      try {
        await getJSON('/apps/ngiab/whatever/');
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ApiError);
      expect(caught.status).to.equal(500);
    },
  ));

// A network-level failure has no response object to inspect.
it('raises a useful error when the request never completes', () => {
  const original = window.fetch;
  window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  return (async () => {
    let caught = null;
    try {
      await getJSON('/apps/ngiab/getModelRuns/');
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(ApiError);
    expect(caught.message).to.contain('Network request');
    expect(caught.status).to.equal(null);
  })().finally(() => {
    window.fetch = original;
  });
});

it('exposes exactly the in-scope viewer endpoints', () => {
  expect(Object.keys(appAPI).sort()).to.deep.equal([
    'getCatchmentTimeSeries',
    'getCatchmentValueMatrix',
    'getCatchmentVariables',
    'getGeoSpatialData',
    'getModelRuns',
    'getTeehrLocations',
    'getTeehrTimeSeries',
    'getTeehrVariables',
    'getTrouteTimeSeries',
    'getTrouteVariables',
    'removeModelRun',
  ]);
});
