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

export function toUplotData(apiSeries) {
  const series = Array.isArray(apiSeries) ? apiSeries.filter((s) => s && Array.isArray(s.data)) : [];
  if (!series.length) return { data: [[]], labels: [], points: 0 };

  // Map of epoch-second -> per-series value, built in one pass.
  const byTime = new Map();
  series.forEach((s, seriesIndex) => {
    for (const point of s.data) {
      const t = toEpochSeconds(point?.x);
      if (t === null) continue;
      let row = byTime.get(t);
      if (!row) {
        row = new Array(series.length).fill(null);
        byTime.set(t, row);
      }
      row[seriesIndex] = toFiniteNumber(point?.y);
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
