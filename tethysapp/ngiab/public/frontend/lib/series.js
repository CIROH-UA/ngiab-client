// Converts the API's time-series payloads into the column-oriented arrays uPlot wants.
//
// Every series endpoint returns the same envelope:
//   { data: [ { label, data: [ {x, y}, ... ] }, ... ], layout: { yaxis, ... } }
// but the `x` values are NOT uniform:
//   - getTrouteTimeSeries  -> "2024-01-01 00:00:00"   (strftime, space separated)
//   - getTeehrTimeSeries   -> "2024-01-01T00:00:00"   (Django serializing a datetime)
//   - getCatchmentTimeSeries -> whatever the output CSV's time column held
// A space-separated timestamp is not valid ISO 8601, so parsing is normalised here rather
// than trusted to Date.

/**
 * Best-effort conversion of an API `x` value to epoch SECONDS (uPlot's unit).
 * Returns null when the value cannot be interpreted, so callers can drop the point
 * instead of plotting NaN (which silently blanks a whole series).
 */
export function toEpochSeconds(x) {
  if (x === null || x === undefined) return null;

  if (typeof x === 'number' && Number.isFinite(x)) {
    // Heuristic: anything past ~5138 AD in seconds is far more likely milliseconds.
    return x > 1e11 ? x / 1000 : x;
  }

  if (typeof x !== 'string') return null;

  const trimmed = x.trim();
  if (!trimmed) return null;

  // "2024-01-01 00:00:00" -> "2024-01-01T00:00:00". Both are treated as local time,
  // matching how the old chart rendered them.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(trimmed)
    ? trimmed.replace(' ', 'T')
    : trimmed;

  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms / 1000;
}

// A missing observation must become null (uPlot draws a break), never 0. Number() is
// treacherous here: Number(null), Number('') and Number([]) are all 0, so a gap in the
// record would silently plot as zero flow.
const toFiniteNumber = (y) => {
  if (typeof y === 'number') return Number.isFinite(y) ? y : null;
  if (typeof y !== 'string') return null;
  const trimmed = y.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

/**
 * Turn one API series list into uPlot's [xs, ...ys] column arrays.
 *
 * uPlot requires every y column to be the same length as x and aligned by index. The
 * endpoints return each series with its own point list, so this unions the timestamps and
 * places each series' values against them, leaving gaps as null (uPlot renders a break).
 *
 * @param {Array<{label: string, data: Array<{x: *, y: *}>}>} apiSeries
 * @returns {{ data: Array<Array<number|null>>, labels: string[], points: number }}
 */
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
