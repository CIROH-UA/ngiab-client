import { expect } from '@esm-bundle/chai';
import { applyPitch, pitchFor, PITCH_3D, PITCH_FLAT } from './camera.js';

const fakeMap = () => ({
  moving: false,
  eases: [],
  _idle: [],
  isMoving() {
    return this.moving;
  },
  once(event, cb) {
    if (event === 'idle') this._idle.push(cb);
  },
  easeTo(options) {
    this.eases.push(options);
  },
  fireIdle() {
    const cbs = this._idle.splice(0);
    for (const cb of cbs) cb();
  },
});

const freshState = () => ({ deferred: false, pitch: PITCH_FLAT });

describe('pitchFor', () => {
  it('tilts the camera for extrusion or terrain, and lies flat otherwise', () => {
    expect(pitchFor({ extrude: true })).to.equal(PITCH_3D);
    expect(pitchFor({ terrain: true })).to.equal(PITCH_3D);
    expect(pitchFor({})).to.equal(PITCH_FLAT);
  });
});

describe('applyPitch', () => {
  it('eases immediately when the camera is at rest', () => {
    const map = fakeMap();
    applyPitch(map, PITCH_3D, freshState());
    expect(map.eases).to.have.length(1);
    expect(map.eases[0].pitch).to.equal(PITCH_3D);
  });

  it('defers past an in-flight fly, then eases once the map goes idle', () => {
    const map = fakeMap();
    map.moving = true;
    const state = freshState();
    applyPitch(map, PITCH_3D, state);
    expect(map.eases).to.have.length(0);
    expect(state.deferred).to.equal(true);

    map.fireIdle();
    expect(map.eases).to.have.length(1);
    expect(map.eases[0].pitch).to.equal(PITCH_3D);
    expect(state.deferred).to.equal(false);
  });

  it('applies only the latest target when toggled twice during one fly', () => {
    const map = fakeMap();
    map.moving = true;
    const state = freshState();
    applyPitch(map, PITCH_3D, state);
    applyPitch(map, PITCH_FLAT, state);
    expect(map.eases).to.have.length(0);
    expect(map._idle).to.have.length(1);

    map.fireIdle();
    expect(map.eases).to.have.length(1);
    expect(map.eases[0].pitch).to.equal(PITCH_FLAT);
  });

  it('is a no-op without a map', () => {
    expect(() => applyPitch(null, PITCH_3D, freshState())).to.not.throw();
  });
});
