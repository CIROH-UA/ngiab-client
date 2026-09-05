export const PITCH_3D = 70;
export const PITCH_FLAT = 0;

export const pitchFor = (view) => (view.extrude || view.terrain ? PITCH_3D : PITCH_FLAT);

export function applyPitch(map, pitch, state) {
  if (!map) return;
  state.pitch = pitch;
  if (state.deferred) return;
  if (!map.isMoving()) {
    map.easeTo({ pitch, duration: 500 });
    return;
  }
  state.deferred = true;
  map.once('idle', () => {
    state.deferred = false;
    map.easeTo({ pitch: state.pitch, duration: 500 });
  });
}
