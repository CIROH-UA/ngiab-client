export function createStore(initialState) {
  let state = { ...initialState };
  const subscribers = new Set();

  return {
    get() {
      return state;
    },

    set(patch) {
      state = { ...state, ...patch };
      for (const fn of [...subscribers]) fn(state);
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
