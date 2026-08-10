import { expect } from '@esm-bundle/chai';
import { createStore } from './store.js';

it('returns the initial state from get()', () => {
  const s = createStore({ a: 1 });
  expect(s.get()).to.deep.equal({ a: 1 });
});

it("does not alias the caller's initial-state object", () => {
  const initial = { a: 1 };
  const s = createStore(initial);
  s.set({ a: 2 });
  expect(initial.a).to.equal(1);
});

it('set() shallow-merges a patch and notifies subscribers', () => {
  const s = createStore({ a: 1, b: 2 });
  let seen = null;
  s.subscribe((state) => { seen = state; });
  s.set({ b: 3 });
  expect(s.get()).to.deep.equal({ a: 1, b: 3 });
  expect(seen).to.deep.equal({ a: 1, b: 3 });
});

it('notifies every subscriber', () => {
  const s = createStore({ a: 1 });
  let calls = 0;
  s.subscribe(() => { calls += 1; });
  s.subscribe(() => { calls += 1; });
  s.set({ a: 2 });
  expect(calls).to.equal(2);
});

it('subscribe() returns an unsubscribe that stops notifications', () => {
  const s = createStore({ a: 1 });
  let calls = 0;
  const off = s.subscribe(() => { calls += 1; });
  s.set({ a: 2 });
  off();
  s.set({ a: 3 });
  expect(calls).to.equal(1);
});

it('replaces state rather than mutating it, so snapshots stay stable', () => {
  const s = createStore({ a: 1 });
  const before = s.get();
  s.set({ a: 2 });
  expect(before).to.deep.equal({ a: 1 });
  expect(s.get()).to.not.equal(before);
});

// Guards the copy-before-iterate above: without it this throws or skips a listener.
it('tolerates a subscriber unsubscribing during notification', () => {
  const s = createStore({ a: 1 });
  let second = 0;
  const off = s.subscribe(() => off());
  s.subscribe(() => { second += 1; });
  s.set({ a: 2 });
  expect(second).to.equal(1);
});
