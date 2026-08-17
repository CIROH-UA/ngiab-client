// Converts the API's time-series payloads into the column-oriented arrays uPlot wants.

export function toEpochSeconds(x) {
  if (x === null || x === undefined) return null;

  if (typeof x === 'number' && Number.isFinite(x)) {
    // Heuristic: anything past ~5138 AD in seconds is far more likely milliseconds.
    return x > 1e11 ? x / 1000 : x;
  }

  if (typeof x !== 'string') return null;

  const trimmed = x.trim();
  if (!trimmed) return null;

  // A space-separated timestamp is not valid ISO 8601; normalise it to local time.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(trimmed)
    ? trimmed.replace(' ', 'T')
    : trimmed;

  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms / 1000;
}

// A gap must become null, never 0: Number(null), Number('') and Number([]) are all 0.
const toFiniteNumber = (y) => {
  if (typeof y === 'number') return Number.isFinite(y) ? y : null;
  if (typeof y !== 'string') return null;
  const trimmed = y.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

// Three wire shapes reach this function, so they are flattened to (times, values) first:
//   {data: [{x, y}]}      one object per point, from troute and teehr
//   {t: [...], v: [...]}  columnar, when the time axis is irregular
//   {t0, dt, n, v: [...]} columnar with the time axis implied, when it is regular
// The last two exist because a run's chart is tens of thousands of points and the keys cost
// more than the numbers; see the frontend README.
export function toColumns(s) {
  if (!s) return { times: [], values: [] };

  if (Array.isArray(s.data)) {
    const times = [];
    const values = [];
    for (const point of s.data) {
      const t = toEpochSeconds(point?.x);
      if (t === null) continue;
      times.push(t);
      values.push(toFiniteNumber(point?.y));
    }
    return { times, values };
  }

  const values = Array.isArray(s.v) ? s.v.map(toFiniteNumber) : [];
  if (!values.length) return { times: [], values: [] };

  if (Array.isArray(s.t)) {
    const times = [];
    const kept = [];
    for (let i = 0; i < values.length && i < s.t.length; i += 1) {
      const t = toEpochSeconds(s.t[i]);
      if (t === null) continue;
      times.push(t);
      kept.push(values[i]);
    }
    return { times, values: kept };
  }

  const t0 = toEpochSeconds(s.t0);
  const dt = Number(s.dt);
  if (t0 === null || !Number.isFinite(dt) || dt <= 0) return { times: [], values: [] };
  return { times: values.map((_, i) => t0 + i * dt), values };
}

const hasSeriesData = (s) => s && (Array.isArray(s.data) || Array.isArray(s.v));

export function toUplotData(apiSeries) {
  const series = Array.isArray(apiSeries) ? apiSeries.filter(hasSeriesData) : [];
  if (!series.length) return { data: [[]], labels: [], points: 0 };

  // Map of epoch-second -> per-series value, built in one pass.
  const byTime = new Map();
  series.forEach((s, seriesIndex) => {
    const { times, values } = toColumns(s);
    for (let i = 0; i < times.length; i += 1) {
      const t = times[i];
      let row = byTime.get(t);
      if (!row) {
        row = new Array(series.length).fill(null);
        byTime.set(t, row);
      }
      row[seriesIndex] = values[i];
    }
  });

  const times = [...byTime.keys()].sort((a, b) => a - b);
  const columns = series.map(() => new Array(times.length).fill(null));
  times.forEach((t, i) => {
    const row = byTime.get(t);
    for (let s = 0; s < series.length; s += 1) columns[s][i] = row[s];
  });

  return {
    data: [times, ...columns],
    labels: series.map((s, i) => s.label ?? `series ${i + 1}`),
    points: times.length,
  };
}
