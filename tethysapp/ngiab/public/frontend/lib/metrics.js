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

export function formatMetric(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toFixed(3);
}

export function toMetricsTable(metrics) {
  const source = Array.isArray(metrics) ? metrics.filter((r) => r && typeof r === 'object') : [];
  if (!source.length) return { columns: [], rows: [] };

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
