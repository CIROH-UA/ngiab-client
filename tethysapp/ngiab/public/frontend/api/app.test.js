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

// What the user is shown must never contain a status code, a URL, or a traceback.
const noTechnicalDetail = (text) => {
  expect(text).to.be.a('string').and.not.equal('');
  expect(text).to.not.match(/HTTP \d|[45]\d\d|\/apps\/|Traceback|<html/i);
};

describe('user-facing error messages', () => {
  it('does not leak the status code or path on a 500', () =>
    withStubbedFetch(
      () => new Response('<!DOCTYPE html><html>Django debug page</html>', {
        status: 500, headers: { 'Content-Type': 'text/html' },
      }),
      async () => {
        let caught = null;
        try { await appAPI.getCatchmentValueMatrix({ model_run_id: 'r' }); } catch (e) { caught = e; }
        noTechnicalDetail(caught.userMessage);
        // The technical detail still exists for the console.
        expect(caught.message).to.contain('500');
        expect(caught.status).to.equal(500);
      },
    ));

  it('gives each status its own sentence', async () => {
    const seen = new Map();
    for (const status of [400, 403, 404, 500, 503]) {
      await withStubbedFetch(
        () => jsonResponse({}, status),
        async () => {
          try { await getJSON('/apps/ngiab/x/'); } catch (e) { seen.set(status, e.userMessage); }
        },
      );
    }
    for (const [, message] of seen) noTechnicalDetail(message);
    expect(seen.get(404)).to.not.equal(seen.get(500));
  });

  it('passes a server error string through when it reads like a sentence', () =>
    withStubbedFetch(
      () => jsonResponse({ error: 'This model run has no plottable troute variables.' }),
      async () => {
        let caught = null;
        try { await appAPI.getTrouteTimeSeries({ troute_id: 'cat-1' }); } catch (e) { caught = e; }
        expect(caught.userMessage).to.equal('This model run has no plottable troute variables.');
      },
    ));

  // A shared ?model_run_id= link outlives the run it names; the panel has to say so rather
  // than offer the retry that a generic 404 message implies.
  it('shows the server sentence on a 404, not the generic status text', () =>
    withStubbedFetch(
      () => jsonResponse({ error: 'No such model run.' }, 404),
      async () => {
        let caught = null;
        try { await appAPI.getGeoSpatialData({ model_run_id: 'gone' }); } catch (e) { caught = e; }
        expect(caught).to.be.instanceOf(ApiError);
        expect(caught.status).to.equal(404);
        expect(caught.userMessage).to.equal('No such model run.');
      },
    ));

  // A traceback is a sentence-shaped trap: it would sail through a length check alone.
  it('refuses a traceback or HTML as a user message', () =>
    withStubbedFetch(
      () => jsonResponse({ error: 'Traceback (most recent call last):\n  File "x.py"' }),
      async () => {
        let caught = null;
        try { await appAPI.getGeoSpatialData({ model_run_id: 'r' }); } catch (e) { caught = e; }
        noTechnicalDetail(caught.userMessage);
        expect(caught.userMessage).to.not.contain('Traceback');
      },
    ));

  it('explains a network failure without jargon', () => {
    const original = window.fetch;
    window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    return (async () => {
      let caught = null;
      try { await getJSON('/apps/ngiab/getModelRuns/'); } catch (e) { caught = e; }
      noTechnicalDetail(caught.userMessage);
      expect(caught.userMessage).to.match(/reach the server/i);
    })().finally(() => { window.fetch = original; });
  });

  it('reports a 200 carrying HTML instead of failing to parse', () =>
    withStubbedFetch(
      () => new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      async () => {
        let caught = null;
        try { await getJSON('/apps/ngiab/getModelRuns/'); } catch (e) { caught = e; }
        expect(caught).to.be.instanceOf(ApiError);
        noTechnicalDetail(caught.userMessage);
      },
    ));
});
