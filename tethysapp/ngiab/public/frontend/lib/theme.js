// tokens.css keys its dark values off :root[data-theme="dark"], so the attribute has to be
// set for the panel cards to follow the basemap.

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

export function syncDocumentTheme(store) {
  applyTheme(store.get().theme);
  return store.subscribe(() => applyTheme(store.get().theme));
}
