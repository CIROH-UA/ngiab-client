export function getConfig() {
  const cfg = (typeof window !== 'undefined' && window.__NGIAB__) || {};
  return {
    APP_ROOT_URL: cfg.APP_ROOT_URL || '/apps/ngiab/',
    PORTAL_HOST: cfg.PORTAL_HOST || '',
    MODEL_RUN_ID: cfg.MODEL_RUN_ID || '',
    SIGNED_IN: cfg.SIGNED_IN === true,
    CAN_DELETE: cfg.CAN_DELETE === true,
    MAX_UPLOAD_BYTES: Number(cfg.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024 * 1024,
    USERNAME: cfg.USERNAME || '',
    LOGIN_URL: cfg.LOGIN_URL || '/accounts/login/',
    LOGOUT_URL: cfg.LOGOUT_URL || '/accounts/logout/',
  };
}

export function maxUploadBytes() {
  return getConfig().MAX_UPLOAD_BYTES;
}

export function isSignedIn() {
  return getConfig().SIGNED_IN;
}

// Uploading takes an account and nothing more today, so this is the same answer -- but it is
// a different question, and a permission added here must not silently move the account row.
export function canUpload() {
  return isSignedIn();
}

export function canSeeDelete() {
  const cfg = getConfig();
  return cfg.SIGNED_IN && cfg.CAN_DELETE;
}

export function userName() {
  return getConfig().USERNAME;
}

// Sign in comes back to the page you left, selected run and all, rather than the portal's
// profile page. Signing out cannot: the portal's logout view ignores next and redirects to
// its own home or login, so adding one here would only promise something it does not do.
export function loginUrl() {
  const here = window.location.pathname + window.location.search;
  const url = getConfig().LOGIN_URL;
  return `${url}${url.includes('?') ? '&' : '?'}next=${encodeURIComponent(here)}`;
}

export function logoutUrl() {
  return getConfig().LOGOUT_URL;
}

export function getPortalHost() {
  const host = getConfig().PORTAL_HOST;
  if (host) return host;
  return new URL(window.location.href).origin;
}

export function getModelRunId() {
  const fromUrl = new URLSearchParams(window.location.search).get('model_run_id');
  return fromUrl || getConfig().MODEL_RUN_ID || '';
}
