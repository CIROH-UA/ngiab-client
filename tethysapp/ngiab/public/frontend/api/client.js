import { getPortalHost } from '../config.js';

// A thin fetch wrapper standing in for the React app's axios client.

// Two audiences per failure: `message` carries the status and path for the console, and
// `userMessage` is what a panel is allowed to show. Status codes and URLs are not answers to
// "what went wrong", so they never reach the interface.
export class ApiError extends Error {
  constructor(message, { status = null, body = null, userMessage = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.userMessage = userMessage ?? GENERIC_MESSAGE;
  }
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

const STATUS_MESSAGES = {
  400: 'That request was not valid.',
  403: 'You do not have permission to view this.',
  404: 'That data is not on the server.',
  408: 'The server took too long to answer. Please try again.',
  409: 'The server is busy with this data. Please try again shortly.',
  500: 'The server could not process this data.',
  502: 'The server is not responding. Please try again shortly.',
  503: 'The server is unavailable. Please try again shortly.',
  504: 'The server took too long to answer. Please try again.',
};

const messageForStatus = (status) => STATUS_MESSAGES[status] ?? GENERIC_MESSAGE;

// A tethys traceback, a Django debug page or a bare exception repr is not a user-facing
// sentence. Only short single-line text is passed through.
function usableServerMessage(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (/\n|Traceback|<html|<!DOCTYPE|at 0x[0-9a-f]+/i.test(trimmed)) return null;
  return trimmed;
}

// A failed response may be JSON with an error key, or Django's HTML debug page. Reading it
// must never throw, or the real failure is replaced by a parse error.
async function readErrorDetail(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return typeof parsed?.error === 'string' ? parsed.error : null;
    } catch {
      return null; // HTML debug page
    }
  } catch {
    return null;
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
    throw new ApiError(`Network request to ${path} failed`, {
      body: String(cause),
      userMessage: 'Could not reach the server. Check your connection and try again.',
    });
  }

  if (response.status === 401) {
    loginRedirect();
    throw new ApiError('Not authenticated', {
      status: 401,
      userMessage: 'Your session has expired. Redirecting you to sign in.',
    });
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new ApiError(`HTTP ${response.status} from ${path}${detail ? `: ${detail}` : ''}`, {
      status: response.status,
      userMessage: usableServerMessage(detail) ?? messageForStatus(response.status),
    });
  }

  let body;
  try {
    body = await response.json();
  } catch (cause) {
    // 200 with a non-JSON body: a proxy or login page standing in for the endpoint.
    throw new ApiError(`Malformed JSON from ${path}`, {
      body: String(cause),
      userMessage: 'The server sent back something unreadable.',
    });
  }

  // Some controllers report failure as HTTP 200 plus an 'error' key. That text is written for
  // the user, so it is shown as-is when it reads like a sentence.
  if (body && body.error) {
    throw new ApiError(body.error, {
      status: response.status,
      body,
      userMessage: usableServerMessage(body.error) ?? GENERIC_MESSAGE,
    });
  }

  return body;
}
