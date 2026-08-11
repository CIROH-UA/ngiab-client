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

  setVariable: (variable) => store.set({ variable }),
  setTeehrVariable: (teehrVariable) => store.set({ teehrVariable }),
  setTrouteVariable: (trouteVariable) => store.set({ trouteVariable }),

  setTheme: (theme) => store.set({ theme }),

  // Layers is a nested object, so patch it whole rather than relying on the shallow merge.
  setLayer(name, value) {
    store.set({ layers: { ...store.get().layers, [name]: value } });
  },
};
