import { createStore } from './store.js';

// The single app-wide store.
//
// It holds only what crosses component boundaries. Tile-derived caches (the catchment
// search index, the catchment -> nexus map harvested from loaded vector tiles) stay local
// to the map, because nothing else reads them and they churn on every pan.
export const store = createStore({
  modelRunId: null,

  // The selected feature. `type` is always 'catchment' -- nexus was dropped from the
  // product (see the design spec's scope decisions), so this exists to keep the shape
  // stable if another geometry type is ever added.
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

// Named mutators, so the set of legal transitions lives in one readable place rather than
// being spread across components calling store.set() directly.
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

  // A catchment click or search hit. Clears the previously selected variables: they belong
  // to the old feature's endpoint and may not exist on the new one.
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
