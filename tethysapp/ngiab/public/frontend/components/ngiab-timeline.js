import { store, actions } from '../store/app-store.js';
import { formatFrameTime } from '../lib/choropleth.js';

// Frames per second at 1x, slow enough that a step's writes land inside one interval.
const BASE_FPS = 6;

// Capped at 8x: past roughly 50 fps the map lags the slider instead of going faster.
const SPEEDS = [0.5, 1, 2, 4, 8];

export class NgiabTimeline extends HTMLElement {
  connectedCallback() {
    this._times = [];
    this._timer = null;
    this._speed = 1;

    const speedOptions = SPEEDS.map(
      (rate) => `<option value="${rate}"${rate === 1 ? ' selected' : ''}>${rate}×</option>`,
    ).join('');

    this.innerHTML = `
      <button id="timeline-play" type="button" aria-label="Play">▶</button>
      <input id="timeline-range" type="range" min="0" max="0" value="0" step="1"
             aria-label="Timestep" />
      <output id="timeline-stamp"></output>
      <select id="timeline-speed" aria-label="Playback speed">${speedOptions}</select>
    `;

    this._playEl = this.querySelector('#timeline-play');
    this._rangeEl = this.querySelector('#timeline-range');
    this._stampEl = this.querySelector('#timeline-stamp');
    this._speedEl = this.querySelector('#timeline-speed');

    this._onInput = () => actions.setFrame(Number(this._rangeEl.value));
    this._onPlay = () => actions.setPlaying(!store.get().playing);
    this._onSpeed = () => {
      this._speed = Number(this._speedEl.value) || 1;
      // Restart so a rate change takes effect now rather than after the current interval.
      this._stop();
      if (store.get().playing) this._start();
    };

    this._rangeEl.addEventListener('input', this._onInput);
    this._playEl.addEventListener('click', this._onPlay);
    this._speedEl.addEventListener('change', this._onSpeed);

    this._unsubscribe = store.subscribe(() => this.render());
    this.render();
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    this._stop();
    this._rangeEl?.removeEventListener('input', this._onInput);
    this._playEl?.removeEventListener('click', this._onPlay);
    this._speedEl?.removeEventListener('change', this._onSpeed);
  }

  setTimes(times) {
    this._times = Array.isArray(times) ? times : [];
    actions.setFrameCount(this._times.length);
    this.render();
  }

  render() {
    const { frameIndex, frameCount, playing, mapVariable } = store.get();

    this.hidden = !mapVariable || frameCount < 2;
    if (this.hidden) {
      this._stop();
      return;
    }

    this._rangeEl.max = String(frameCount - 1);
    // Guarded: writing .value on every store change would fight the user mid-drag.
    if (Number(this._rangeEl.value) !== frameIndex) this._rangeEl.value = String(frameIndex);

    this._playEl.textContent = playing ? '⏸' : '▶';
    this._playEl.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    this._stampEl.textContent = formatFrameTime(this._times[frameIndex] ?? '');

    if (playing) this._start();
    else this._stop();
  }

  _start() {
    if (this._timer) return;
    this._timer = setInterval(() => actions.stepFrame(1), 1000 / (BASE_FPS * this._speed));
  }

  _stop() {
    if (!this._timer) return;
    clearInterval(this._timer);
    this._timer = null;
  }
}

customElements.define('ngiab-timeline', NgiabTimeline);
