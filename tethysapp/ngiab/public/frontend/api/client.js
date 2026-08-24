import { getPortalHost } from '../config.js';

// A thin fetch wrapper standing in for the React app's axios client.

// `message` is for the console; only `userMessage` may reach the interface.
export class ApiError extends Error {
  constructor(message, {
    status = null, body = null, userMessage = null, retryable = false,
  } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.userMessage = userMessage ?? GENERIC_MESSAGE;
    this.retryable = retryable;
  }
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

const STATUS_MESSAGES = {
  400: 'That request was not valid.',
  403: 'You do not have permission to do that.',
  404: 'That data is not on the server.',
  408: 'The server took too long to answer. Please try again.',
  409: 'The server is busy with this data. Please try again shortly.',
  500: 'The server could not process this data.',
  502: 'The server is not responding. Please try again shortly.',
  503: 'The server is unavailable. Please try again shortly.',
  504: 'The server took too long to answer. Please try again.',
};

const messageForStatus = (status) => STATUS_MESSAGES[status] ?? GENERIC_MESSAGE;

// Statuses that mean "ask again", not "give up". A poller that treats every failure as final
// turns a momentary blip into a reported failure for work that is still running -- and the
// blip need not even reach the server, so keying off a response body would not be enough.
const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

// Only short single-line text is a user-facing sentence; tracebacks and HTML are not.
function usableServerMessage(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (/\n|Traceback|<html|<!DOCTYPE|at 0x[0-9a-f]+/i.test(trimmed)) return null;
  return trimmed;
}

// Must never throw, or a parse error would replace the real failure.
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

// Django sets this cookie on any rendered page; a mutating request must echo it back.
// Exported because the upload path sends its body through XMLHttpRequest, which needs the
// same token and has no business parsing the cookie a second time.
export function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

// Shared by both verbs, so a POST reports failure exactly as a GET does.
async function handle(response, path) {
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
      retryable: RETRYABLE_STATUSES.has(response.status),
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

  // Some controllers report failure as HTTP 200 plus an 'error' key, written for the user.
  if (body && body.error) {
    throw new ApiError(body.error, {
      status: response.status,
      body,
      userMessage: usableServerMessage(body.error) ?? GENERIC_MESSAGE,
    });
  }

  return body;
}

// One send for both verbs: the network-failure branch was copied between them.
async function send(url, init, path) {
  let response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    // Network-level failure: there is no response object to inspect.
    throw new ApiError(`Network request to ${path} failed`, {
      body: String(cause),
      userMessage: 'Could not reach the server. Check your connection and try again.',
    });
  }
  return handle(response, path);
}

export function postJSON(path, params = {}) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') form.set(key, value);
  }

  return send(
    new URL(path, getPortalHost()),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': csrfToken(),
      },
      credentials: 'same-origin',
      body: form.toString(),
    },
    path,
  );
}

export function getJSON(path, params = {}) {
  const url = new URL(path, getPortalHost());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  return send(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }, path);
}
