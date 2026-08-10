// Runtime config, injected by the Django template into window.__NGIAB__.
//
// Replaces the React build's compile-time process.env substitution: with no build step
// there is nothing to substitute, so the values arrive at runtime instead.

export function getConfig() {
  const cfg = (typeof window !== 'undefined' && window.__NGIAB__) || {};
  return {
    APP_ROOT_URL: cfg.APP_ROOT_URL || '/apps/ngiab/',
    PORTAL_HOST: cfg.PORTAL_HOST || '',
    MODEL_RUN_ID: cfg.MODEL_RUN_ID || '',
  };
}

// The portal origin: the injected value, else wherever the page was served from.
export function getPortalHost() {
  const host = getConfig().PORTAL_HOST;
  if (host) return host;
  return new URL(window.location.href).origin;
}

// The model run to display. The URL wins over the template default so a run can be shared
// as a link. A run selector is deferred -- see the design spec's scope decisions.
export function getModelRunId() {
  const fromUrl = new URLSearchParams(window.location.search).get('model_run_id');
  return fromUrl || getConfig().MODEL_RUN_ID || '';
}
