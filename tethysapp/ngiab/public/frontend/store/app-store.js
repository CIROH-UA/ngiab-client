import { createStore } from './store.js';
import { applyTheme } from '../lib/theme.js';

export const store = createStore({
  modelRunId: null,

  selection: { type: null, id: null, label: null },

  trouteId: null,
  teehrId: null,

  variable: null,
  teehrVariable: null,
  trouteVariable: null,

  theme: 'light', // 'light' | 'dark'
  layers: { catchmentHidden: false, showTeehr: true },

  mapVariable: null,
  frameIndex: 0,
  frameCount: 0,
  playing: false,
});

export const actions = {
  setModelRun(modelRunId) {
    store.set({
      modelRunId,
      selection: { type: null, id: null, label: null },
      trouteId: null,
      teehrId: null,
      variable: null,
      teehrVariable: null,
      trouteVariable: null,
      mapVariable: null,
      frameIndex: 0,
      frameCount: 0,
      playing: false,
    });
  },

  selectCatchment({ id, label, trouteId, teehrId }) {
    store.set({
      selection: { type: 'catchment', id, label: label ?? String(id) },
      trouteId: trouteId ?? id,
      teehrId: teehrId ?? null,
      variable: null,
      teehrVariable: null,
      trouteVariable: null,
    });
  },

  clearSelection() {
    store.set({
      selection: { type: null, id: null, label: null },
      trouteId: null,
      teehrId: null,
      variable: null,
      teehrVariable: null,
      trouteVariable: null,
    });
  },

  setMapVariable: (mapVariable) =>
    store.set({ mapVariable, frameIndex: 0, frameCount: 0, playing: false }),

  setFrameCount(frameCount) {
    const { frameIndex } = store.get();
    store.set({
      frameCount,
      frameIndex: Math.min(frameIndex, Math.max(frameCount - 1, 0)),
      playing: frameCount > 1 ? store.get().playing : false,
    });
  },

  setFrame(frameIndex) {
    const { frameCount } = store.get();
    const last = Math.max(frameCount - 1, 0);
    store.set({ frameIndex: Math.min(Math.max(frameIndex, 0), last) });
  },

  stepFrame(delta) {
    const { frameIndex, frameCount } = store.get();
    if (frameCount < 1) return;
    store.set({ frameIndex: (frameIndex + delta + frameCount) % frameCount });
  },

  setPlaying: (playing) => store.set({ playing: playing && store.get().frameCount > 1 }),

  setVariable: (variable) => store.set({ variable }),
  setTeehrVariable: (teehrVariable) => store.set({ teehrVariable }),
  setTrouteVariable: (trouteVariable) => store.set({ trouteVariable }),

  setTheme(theme) {
    applyTheme(theme);
    store.set({ theme });
  },

  setLayer(name, value) {
    store.set({ layers: { ...store.get().layers, [name]: value } });
  },
};
