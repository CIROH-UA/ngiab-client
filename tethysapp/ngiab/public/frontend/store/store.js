// Minimal observable store: get / set (shallow merge) / subscribe.
//
// Replaces React Context + useReducer. Deliberately tiny -- the app's shared state is a
// handful of ids and booleans, and every abstraction beyond this (selectors, middleware,
// path subscriptions) would be speculative.
export function createStore(initialState) {
  let state = { ...initialState };
  const subscribers = new Set();

  return {
    get() {
      return state;
    },

    set(patch) {
      state = { ...state, ...patch };
      // Iterate a copy: a subscriber may unsubscribe during notification, and mutating the
      // Set mid-iteration would skip listeners.
      for (const fn of [...subscribers]) fn(state);
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
