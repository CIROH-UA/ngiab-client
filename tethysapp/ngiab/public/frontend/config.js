// Runtime config, injected by the Django template into window.__NGIAB__.

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

// Whether to offer the upload panel.
//
// Unlike delete, this is hidden from anonymous visitors too. The delete button stays visible
// signed out because its 401 is a route to the login page; the upload panel is a form, and
// filling one in before being told to sign in is worse than not being offered it.
export function canUpload() {
  return getConfig().CAN_UPLOAD;
}

// Whether to render the delete control at all.
//
// Both flags default false, which reads as "anonymous": the control stays visible so the
// server's 401 can send an unauthenticated visitor to sign in. Only a signed-in user who has
// been refused the permission loses the button, because for them it is a dead end.
export function canSeeDelete() {
  const cfg = getConfig();
  return cfg.CAN_DELETE || !cfg.SIGNED_IN;
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
