import { expect } from '@esm-bundle/chai';
import { toMetricsTable, metricLabel, configLabel, formatMetric } from './metrics.js';

// The real payload, copied from a live getTeehrTimeSeries response.
const REAL = [
  { metric: 'root_mean_standard_deviation_ratio', ngen_gage_10154200: 0.7245604395866394, nwm30_retrospective: 0.6264227032661438 },
  { metric: 'relative_bias', ngen_gage_10154200: -0.26382875442504883, nwm30_retrospective: 0.05937769263982773 },
  { metric: 'nash_sutcliffe_efficiency', ngen_gage_10154200: 0.4750121235847473, nwm30_retrospective: 0.6075945496559143 },
  { metric: 'kling_gupta_efficiency', ngen_gage_10154200: 0.6404110193252563, nwm30_retrospective: 0.719469428062439 },
];

describe('metricLabel', () => {
  it('uses the conventional short form for teehr\'s four metrics', () => {
    expect(metricLabel('kling_gupta_efficiency')).to.equal('KGE');
    expect(metricLabel('nash_sutcliffe_efficiency')).to.equal('NSE');
    expect(metricLabel('relative_bias')).to.equal('Relative bias');
    expect(metricLabel('root_mean_standard_deviation_ratio')).to.equal('RMSDR');
  });

  // teehr adding a metric must not make it invisible.
  it('title-cases anything unrecognised rather than dropping it', () => {
    expect(metricLabel('some_new_metric')).to.equal('Some New Metric');
  });
});

describe('configLabel', () => {
  it('humanises the run-specific configuration name', () => {
    expect(configLabel('ngen_gage_10154200')).to.equal('Ngen Gage 10154200');
    expect(configLabel('nwm30_retrospective')).to.equal('Nwm30 Retrospective');
  });
});

describe('formatMetric', () => {
  it('formats to a fixed 3 decimals', () => {
    expect(formatMetric(0.6404110193252563)).to.equal('0.640');
    expect(formatMetric(-0.26382875442504883)).to.equal('-0.264');
  });

  it('keeps a genuine zero', () => {
    expect(formatMetric(0)).to.equal('0.000');
  });

  // An absent metric must be visibly absent, not rendered as 0.000.
  it('shows a dash for anything non-numeric', () => {
    for (const bad of [null, undefined, '', 'n/a', NaN, Infinity, {}]) {
      expect(formatMetric(bad), String(bad)).to.equal('-');
    }
  });
});

describe('toMetricsTable', () => {
  it('derives columns from the payload, since configuration names are run-specific', () => {
    const { columns } = toMetricsTable(REAL);
    expect(columns.map((c) => c.key)).to.deep.equal(['ngen_gage_10154200', 'nwm30_retrospective']);
    expect(columns.map((c) => c.label)).to.deep.equal(['Ngen Gage 10154200', 'Nwm30 Retrospective']);
  });

  it('builds one row per metric, values aligned to the columns', () => {
    const { rows } = toMetricsTable(REAL);
    expect(rows).to.have.lengthOf(4);
    const kge = rows.find((r) => r.key === 'kling_gupta_efficiency');
    expect(kge.label).to.equal('KGE');
    expect(kge.values).to.deep.equal(['0.640', '0.719']);
  });

  it('preserves the payload row order', () => {
    expect(toMetricsTable(REAL).rows.map((r) => r.key)).to.deep.equal(REAL.map((r) => r.metric));
  });

  // A configuration missing from the first row must not lose its column for the rest.
  it('unions columns across all rows', () => {
    const { columns, rows } = toMetricsTable([
      { metric: 'a', only_in_first: 1 },
      { metric: 'b', only_in_second: 2 },
    ]);
    expect(columns.map((c) => c.key)).to.deep.equal(['only_in_first', 'only_in_second']);
    expect(rows[0].values).to.deep.equal(['1.000', '-']);
    expect(rows[1].values).to.deep.equal(['-', '2.000']);
  });

  it('returns an empty table for empty or malformed input', () => {
    for (const bad of [null, undefined, [], [null], 'nope']) {
      const out = toMetricsTable(bad);
      expect(out.rows, JSON.stringify(bad)).to.have.lengthOf(0);
      expect(out.columns).to.have.lengthOf(0);
    }
  });
});
