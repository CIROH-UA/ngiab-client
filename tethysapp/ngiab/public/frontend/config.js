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
    VERSION: cfg.VERSION || '',
    TERRAIN_URL: cfg.TERRAIN_URL || 'https://download.mapterhorn.com/planet.pmtiles',
    TERRAIN_EXAGGERATION: Number(cfg.TERRAIN_EXAGGERATION) || 3,
    TERRAIN_TILE_SIZE: Number(cfg.TERRAIN_TILE_SIZE) || 512,
  };
}

export function terrainUrl() {
  return getConfig().TERRAIN_URL;
}

export function terrainExaggeration() {
  return getConfig().TERRAIN_EXAGGERATION;
}

export function terrainTileSize() {
  return getConfig().TERRAIN_TILE_SIZE;
}

export function maxUploadBytes() {
  return getConfig().MAX_UPLOAD_BYTES;
}

export function isSignedIn() {
  return getConfig().SIGNED_IN;
}

export function canUpload() {
  return isSignedIn();
}

export function canSeeDelete() {
  const cfg = getConfig();
  return cfg.SIGNED_IN && cfg.CAN_DELETE;
}

export function appVersion() {
  return getConfig().VERSION;
}

export function userName() {
  return getConfig().USERNAME;
}

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
