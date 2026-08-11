// Runtime config, injected by the Django template into window.__NGIAB__.

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

// The URL wins over the template default, so a run stays shareable as a link.
export function getModelRunId() {
  const fromUrl = new URLSearchParams(window.location.search).get('model_run_id');
  return fromUrl || getConfig().MODEL_RUN_ID || '';
}
