import { getPortalHost } from '../config.js';

// A thin fetch wrapper standing in for the React app's axios client.
//
// Deviates from the design spec, which called for porting axios verbatim. Everything the
// app actually used it for -- a base URL, JSON headers, unwrapping the body, and the 401
// redirect -- is a few lines here, and dropping it removes a CDN dependency and an
// import-map entry. Same reasoning as not replacing react-toastify.

export class ApiError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function loginRedirect() {
  const host = getPortalHost();
  window.location.assign(`${host}/accounts/login?next=${window.location.pathname}`);
}

/**
 * GET a JSON endpoint.
 *
 * @param {string} path   Absolute path, e.g. "/apps/ngiab/getModelRuns/".
 * @param {object} params Query parameters; undefined/null values are omitted.
 */
export async function getJSON(path, params = {}) {
  const url = new URL(path, getPortalHost());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
  } catch (cause) {
    // Network-level failure: no response at all. The React client dereferenced
    // error.response here and threw a confusing TypeError instead.
    throw new ApiError(`Network request to ${path} failed`, { body: String(cause) });
  }

  if (response.status === 401) {
    loginRedirect();
    throw new ApiError('Not authenticated', { status: 401 });
  }
  if (!response.ok) {
    throw new ApiError(`HTTP ${response.status} from ${path}`, { status: response.status });
  }

  const body = await response.json();

  // Several controllers report failure with HTTP 200 plus an "error" key
  // (getGeoSpatialData does), so response.ok alone is not a sufficient check.
  if (body && body.error) {
    throw new ApiError(body.error, { status: response.status, body });
  }

  return body;
}
