// Minimal observable store: get / set (shallow merge) / subscribe.
export function createStore(initialState) {
  let state = { ...initialState };
  const subscribers = new Set();

  return {
    get() {
      return state;
    },

    set(patch) {
      state = { ...state, ...patch };
      // Iterate a copy: a subscriber may unsubscribe mid-notification.
      for (const fn of [...subscribers]) fn(state);
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
