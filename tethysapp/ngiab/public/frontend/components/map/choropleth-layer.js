import { SRC_DIVIDES, LAYER_DIVIDES } from './layers.js';
import { decodeBins, frameAt } from '../../lib/choropleth.js';

export class ChoroplethState {
  constructor(map) {
    this._map = map;
    this.clear();
  }

  clear() {
    this._bins = new Uint8Array(0);
    this._norms = new Uint8Array(0);
    this._ids = [];
    this._times = [];
    this._breaks = [];
    this._variable = null;
    this._frame = -1;
    this._removeState();
  }

  load(matrix) {
    this.clear();
    this._bins = decodeBins(matrix?.bins);
    this._norms = decodeBins(matrix?.norms);
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
    const count = this._ids.length;
    const bins = frameAt(this._bins, this.frameCount, count, frameIndex);
    const norms = frameAt(this._norms, this.frameCount, count, frameIndex);
    if (!bins.length) return;

    const prevBins = frameAt(this._bins, this.frameCount, count, this._frame);
    const prevNorms = frameAt(this._norms, this.frameCount, count, this._frame);
    for (let index = 0; index < bins.length; index += 1) {
      if (prevBins[index] !== bins[index] || prevNorms[index] !== norms[index]) {
        this._setState(this._ids[index], bins[index], norms[index]);
      }
    }

    this._frame = frameIndex;
  }

  reapply() {
    if (!this.isLoaded || this._frame < 0) return;
    const bins = frameAt(this._bins, this.frameCount, this._ids.length, this._frame);
    const norms = frameAt(this._norms, this.frameCount, this._ids.length, this._frame);
    for (let index = 0; index < bins.length; index += 1) {
      this._setState(this._ids[index], bins[index], norms[index]);
    }
  }

  _setState(id, bin, val) {
    if (!this._map.getSource(SRC_DIVIDES)) return;
    this._map.setFeatureState(
      { source: SRC_DIVIDES, sourceLayer: LAYER_DIVIDES, id },
      { bin, val },
    );
  }

  _removeState() {
    if (!this._map?.getSource?.(SRC_DIVIDES)) return;
    this._map.removeFeatureState({ source: SRC_DIVIDES, sourceLayer: LAYER_DIVIDES });
  }
}
