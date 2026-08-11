// tokens.css keys dark off :root[data-theme="dark"], so the attribute must be set.

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

export function syncDocumentTheme(store) {
  applyTheme(store.get().theme);
  return store.subscribe(() => applyTheme(store.get().theme));
}
