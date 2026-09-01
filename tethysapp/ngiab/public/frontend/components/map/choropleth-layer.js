import { SRC_DIVIDES, LAYER_DIVIDES } from './layers.js';
import { decodeBins, frameAt, diffFrames } from '../../lib/choropleth.js';

export class ChoroplethState {
  constructor(map) {
    this._map = map;
    this.clear();
  }

  clear() {
    this._bins = new Uint8Array(0);
    this._ids = [];
    this._times = [];
    this._breaks = [];
    this._variable = null;
    this._frame = -1;
    this._applied = null;
    this._removeState();
  }

  load(matrix) {
    this.clear();
    this._bins = decodeBins(matrix?.bins);
    this._ids = matrix?.catchment_ids ?? [];
    this._times = matrix?.times ?? [];
    this._breaks = matrix?.breaks ?? [];
    this._variable = matrix?.variable ?? null;
  }

  get frameCount() {
    return this._times.length;
  }

  get times() {
    return this._times;
  }

  get breaks() {
    return this._breaks;
  }

  get variable() {
    return this._variable;
  }

  get isLoaded() {
    return this._ids.length > 0 && this._times.length > 0;
  }

  binAt(catchmentId, frameIndex) {
    const column = this._ids.indexOf(catchmentId);
    if (column < 0) return null;
    const frame = frameAt(this._bins, this.frameCount, this._ids.length, frameIndex);
    return frame.length ? frame[column] : null;
  }

  show(frameIndex) {
    if (!this.isLoaded) return;
    const frame = frameAt(this._bins, this.frameCount, this._ids.length, frameIndex);
    if (!frame.length) return;

    for (const index of diffFrames(this._applied, frame)) {
      this._setBin(this._ids[index], frame[index]);
    }

    this._frame = frameIndex;
    this._applied = Uint8Array.from(frame);
  }

  reapply() {
    if (!this.isLoaded || this._frame < 0) return;
    const frame = frameAt(this._bins, this.frameCount, this._ids.length, this._frame);
    for (let index = 0; index < frame.length; index += 1) {
      this._setBin(this._ids[index], frame[index]);
    }
  }

  _setBin(id, bin) {
    if (!this._map.getSource(SRC_DIVIDES)) return;
    this._map.setFeatureState(
      { source: SRC_DIVIDES, sourceLayer: LAYER_DIVIDES, id },
      { bin },
    );
  }

  _removeState() {
    if (!this._map?.getSource?.(SRC_DIVIDES)) return;
    this._map.removeFeatureState({ source: SRC_DIVIDES, sourceLayer: LAYER_DIVIDES });
  }
}
