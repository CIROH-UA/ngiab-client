// Drag-to-resize and collapse for the chart pane.

// Different questions want different amounts of chart, so the height is the user's.
const MIN_HEIGHT = 120;
const KEYBOARD_STEP = 24;

// Leaves room for the map above; a chart taller than this is a chart with no context.
const maxHeight = () => Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.7));

const clamp = (value) => Math.min(Math.max(value, MIN_HEIGHT), maxHeight());

// MapLibre does not observe container resizes, so the pane announces the change.
const announce = () => window.dispatchEvent(new Event('ngiab-pane-resize'));

export function attachPaneResize({ paneEl, handleEl, collapseEl }) {
  if (!paneEl || !handleEl) return () => {};

  let height = paneEl.getBoundingClientRect().height || 220;
  let dragging = false;

  const applyHeight = (next) => {
    height = clamp(next);
    paneEl.style.height = `${height}px`;
    handleEl.setAttribute('aria-valuenow', String(height));
    announce();
  };

  const setCollapsed = (collapsed) => {
    paneEl.classList.toggle('is-collapsed', collapsed);
    if (collapseEl) {
      collapseEl.textContent = collapsed ? '▴' : '▾';
      collapseEl.setAttribute('aria-label', collapsed ? 'Expand chart' : 'Collapse chart');
      collapseEl.setAttribute('aria-expanded', String(!collapsed));
    }
    announce();
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    // Dragging up grows the pane, so the delta is inverted.
    applyHeight(window.innerHeight - event.clientY);
  };

  const onPointerUp = (event) => {
    if (!dragging) return;
    dragging = false;
    handleEl.releasePointerCapture?.(event.pointerId);
    handleEl.classList.remove('is-dragging');
  };

  const onPointerDown = (event) => {
    // Ignore the collapse button living inside the handle.
    if (event.target.closest('button')) return;
    dragging = true;
    handleEl.setPointerCapture?.(event.pointerId);
    handleEl.classList.add('is-dragging');
    event.preventDefault();
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowUp') applyHeight(height + KEYBOARD_STEP);
    else if (event.key === 'ArrowDown') applyHeight(height - KEYBOARD_STEP);
    else if (event.key === 'Enter' || event.key === ' ') {
      setCollapsed(!paneEl.classList.contains('is-collapsed'));
    } else return;
    event.preventDefault();
  };

  const onCollapse = () => setCollapsed(!paneEl.classList.contains('is-collapsed'));

  // A window that shrank below the old height would otherwise leave no map visible.
  const onWindowResize = () => {
    if (height > maxHeight()) applyHeight(height);
  };

  handleEl.addEventListener('pointerdown', onPointerDown);
  handleEl.addEventListener('pointermove', onPointerMove);
  handleEl.addEventListener('pointerup', onPointerUp);
  handleEl.addEventListener('pointercancel', onPointerUp);
  handleEl.addEventListener('keydown', onKeyDown);
  collapseEl?.addEventListener('click', onCollapse);
  window.addEventListener('resize', onWindowResize);

  handleEl.setAttribute('aria-valuemin', String(MIN_HEIGHT));
  handleEl.setAttribute('aria-valuenow', String(Math.round(height)));

  return () => {
    handleEl.removeEventListener('pointerdown', onPointerDown);
    handleEl.removeEventListener('pointermove', onPointerMove);
    handleEl.removeEventListener('pointerup', onPointerUp);
    handleEl.removeEventListener('pointercancel', onPointerUp);
    handleEl.removeEventListener('keydown', onKeyDown);
    collapseEl?.removeEventListener('click', onCollapse);
    window.removeEventListener('resize', onWindowResize);
  };
}
