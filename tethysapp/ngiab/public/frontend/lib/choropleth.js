// Pure helpers for the value matrix the backend sends. No map, no DOM.

// Bin 0 means the run wrote no value for that catchment at that time. It must never be drawn
// as the lowest class -- that is the Number(null) trap again, one step further downstream.
export const NO_DATA_BIN = 0;

// Sequential ramp, index 1..8 matching the bin values. Index 0 is the no-data colour.
export const RAMP = {
  light: [
    'rgba(0,0,0,0)',
    '#f7fbff', '#deebf7', '#c6dbef', '#9ecae1',
    '#6baed6', '#4292c6', '#2171b5', '#084594',
  ],
  dark: [
    'rgba(0,0,0,0)',
    '#08306b', '#0b4a8f', '#1567ab', '#2b8cbe',
    '#4eb3d3', '#7bccc4', '#a8ddb5', '#d9f0a3',
  ],
};

export function decodeBins(base64) {
  if (typeof base64 !== 'string' || base64 === '') return new Uint8Array(0);
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

// The matrix arrives row-major as [time][catchment].
export function frameAt(bins, frameCount, catchmentCount, index) {
  if (index < 0 || index >= frameCount || catchmentCount <= 0) return new Uint8Array(0);
  const start = index * catchmentCount;
  return bins.subarray(start, start + catchmentCount);
}

// Only the catchments whose class actually changed, so scrubbing does not touch every
// feature on every frame. Adjacent hydrograph timesteps mostly share a class.
export function diffFrames(previous, next) {
  const changed = [];
  if (!next) return changed;
  for (let i = 0; i < next.length; i += 1) {
    if (!previous || previous[i] !== next[i]) changed.push(i);
  }
  return changed;
}

export function binColor(bin, theme) {
  const ramp = RAMP[theme === 'dark' ? 'dark' : 'light'];
  if (!Number.isInteger(bin) || bin <= NO_DATA_BIN || bin >= ramp.length) return ramp[0];
  return ramp[bin];
}

// One legend entry per class the backend actually produced, so a variable that collapsed to
// three classes draws three swatches rather than eight, most of them impossible.
export function legendEntries(breaks, theme) {
  const count = (Array.isArray(breaks) ? breaks.length : 0) + 1;
  const entries = [];
  for (let bin = 1; bin <= count; bin += 1) {
    entries.push({ bin, color: binColor(bin, theme), lower: breaks[bin - 2], upper: breaks[bin - 1] });
  }
  return entries;
}

// Significant figures, because these values span orders of magnitude between variables and
// runs: Q_OUT peaks near 1e-4 in one run and could be in the hundreds in another.
export function formatBreak(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1000 || magnitude < 0.001) return value.toExponential(2);
  return String(Number(value.toPrecision(3)));
}

export function legendLabel(entry) {
  const { lower, upper } = entry;
  if (lower === undefined && upper === undefined) return 'all values';
  if (lower === undefined) return `< ${formatBreak(upper)}`;
  if (upper === undefined) return `≥ ${formatBreak(lower)}`;
  return `${formatBreak(lower)} – ${formatBreak(upper)}`;
}

// Read off the string rather than via Date. These stamps are model time with no zone, so
// parsing them shifts them into the viewer's timezone and silently relabels every frame.
export function formatFrameTime(stamp) {
  if (typeof stamp !== 'string' || !stamp) return '';
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(stamp);
  if (!match) return stamp;
  const [, date, time] = match;
  return time === '00:00' ? date : `${date} ${time}`;
}
