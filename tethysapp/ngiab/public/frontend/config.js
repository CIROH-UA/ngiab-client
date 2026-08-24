export function getConfig() {
  const cfg = (typeof window !== 'undefined' && window.__NGIAB__) || {};
  return {
    APP_ROOT_URL: cfg.APP_ROOT_URL || '/apps/ngiab/',
    PORTAL_HOST: cfg.PORTAL_HOST || '',
    MODEL_RUN_ID: cfg.MODEL_RUN_ID || '',
    SIGNED_IN: cfg.SIGNED_IN === true,
    CAN_DELETE: cfg.CAN_DELETE === true,
    CAN_UPLOAD: cfg.CAN_UPLOAD === true,
  };
}

export function canUpload() {
  return getConfig().CAN_UPLOAD;
}

export function canSeeDelete() {
  const cfg = getConfig();
  return cfg.CAN_DELETE || !cfg.SIGNED_IN;
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
