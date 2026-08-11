import { createStore } from './store.js';

// The single app-wide store.
export const store = createStore({
  modelRunId: null,

  // `type` is always 'catchment'; kept for shape stability if another type is added.
  selection: { type: null, id: null, label: null },

  // Ids for the time-series endpoints, derived from the selection.
  trouteId: null,
  teehrId: null,

  // Which series the chart is showing. Null means "the endpoint's first variable".
  variable: null,
  teehrVariable: null,
  trouteVariable: null,

  theme: 'light', // 'light' | 'dark'
  layers: { catchmentHidden: false, showTeehr: true },

  // Which variable shades the map, and where the timeline sits. Null means no choropleth.
  mapVariable: null,
  frameIndex: 0,
  frameCount: 0,
  playing: false,
});

// Named mutators keep the legal state transitions in one readable place.
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

  // Clears the chosen variables: they may not exist on the new feature's endpoint.
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

  // A different run has its own variables, axis and range: nothing may carry over.
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

  // Wraps, so playback loops rather than stopping dead at the last frame.
  stepFrame(delta) {
    const { frameIndex, frameCount } = store.get();
    if (frameCount < 1) return;
    store.set({ frameIndex: (frameIndex + delta + frameCount) % frameCount });
  },

  setPlaying: (playing) => store.set({ playing: playing && store.get().frameCount > 1 }),

  setVariable: (variable) => store.set({ variable }),
  setTeehrVariable: (teehrVariable) => store.set({ teehrVariable }),
  setTrouteVariable: (trouteVariable) => store.set({ trouteVariable }),

  setTheme: (theme) => store.set({ theme }),

  // Layers is a nested object, so patch it whole rather than relying on the shallow merge.
  setLayer(name, value) {
    store.set({ layers: { ...store.get().layers, [name]: value } });
  },
};
