import { getPortalHost } from '../config.js';

// A thin fetch wrapper standing in for the React app's axios client.

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
    // Network-level failure: there is no response object to inspect.
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

  // Some controllers report failure as HTTP 200 plus an 'error' key.
  if (body && body.error) {
    throw new ApiError(body.error, { status: response.status, body });
  }

  return body;
}
