// Shapes the TEEHR metrics payload for display.
//
// getTeehrTimeSeries returns one row per metric, with one column per evaluated
// configuration -- and the configuration names are run-specific, so the columns cannot be
// hard-coded:
//
//   [{ metric: "kling_gupta_efficiency",
//      ngen_gage_10154200: 0.64,
//      nwm30_retrospective: 0.72 }, ...]
//
// Replaces the react-data-table-component table (which came with its own theming layer)
// with a plain table built from this.

// The four metrics teehr computes. Short forms are what hydrologists actually read;
// anything unrecognised falls back to title-cased words rather than being hidden.
const METRIC_LABELS = {
  kling_gupta_efficiency: 'KGE',
  nash_sutcliffe_efficiency: 'NSE',
  relative_bias: 'Relative bias',
  root_mean_standard_deviation_ratio: 'RMSDR',
};

const titleCase = (snake) =>
  String(snake)
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export function metricLabel(name) {
  return METRIC_LABELS[name] ?? titleCase(name);
}

export function configLabel(name) {
  return titleCase(name);
}

/**
 * Format a metric value for display.
 *
 * Fixed 3 decimals rather than significant figures: these are all dimensionless skill
 * scores in roughly the same range, and a fixed column reads far better than mixed
 * precision. Anything non-numeric becomes an em dash so an absent metric is visibly absent
 * rather than rendering as 0.
 */
export function formatMetric(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(3);
}

/**
 * Turn the metrics payload into { columns, rows } ready for a table.
 *
 * @param {Array<object>} metrics
 * @returns {{ columns: Array<{key: string, label: string}>,
 *             rows: Array<{key: string, label: string, values: string[]}> }}
 */
export function toMetricsTable(metrics) {
  const source = Array.isArray(metrics) ? metrics.filter((r) => r && typeof r === 'object') : [];
  if (!source.length) return { columns: [], rows: [] };

  // Column order follows first appearance across all rows, so a metric that is missing a
  // configuration does not drop that column for everyone else.
  const keys = [];
  for (const row of source) {
    for (const key of Object.keys(row)) {
      if (key !== 'metric' && !keys.includes(key)) keys.push(key);
    }
  }

  return {
    columns: keys.map((key) => ({ key, label: configLabel(key) })),
    rows: source.map((row) => ({
      key: row.metric,
      label: metricLabel(row.metric),
      values: keys.map((key) => formatMetric(row[key])),
    })),
  };
}
