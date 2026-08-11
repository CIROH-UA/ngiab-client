import { expect } from '@esm-bundle/chai';
import { toEpochSeconds, toUplotData } from './series.js';

// Local-time epoch seconds, so assertions hold in any timezone.
const localSeconds = (y, mo, d, h = 0, mi = 0, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s).getTime() / 1000;

describe('toEpochSeconds', () => {
  // getTrouteTimeSeries formats with strftime, which is not valid ISO 8601.
  it('parses the space-separated strftime format', () => {
    expect(toEpochSeconds('2024-01-01 06:30:00')).to.equal(localSeconds(2024, 1, 1, 6, 30));
  });

  // getTeehrTimeSeries arrives as Django's datetime serialization.
  it('parses the ISO format', () => {
    expect(toEpochSeconds('2024-01-01T06:30:00')).to.equal(localSeconds(2024, 1, 1, 6, 30));
  });

  it('treats both formats as the same instant', () => {
    expect(toEpochSeconds('2024-03-05 12:00:00')).to.equal(toEpochSeconds('2024-03-05T12:00:00'));
  });

  it('passes through epoch seconds', () => {
    expect(toEpochSeconds(1704096000)).to.equal(1704096000);
  });

  it('converts epoch milliseconds down to seconds', () => {
    expect(toEpochSeconds(1704096000000)).to.equal(1704096000);
  });

  it('returns null for unparseable input rather than NaN', () => {
    for (const bad of [null, undefined, '', '   ', 'not a date', {}, []]) {
      expect(toEpochSeconds(bad), String(bad)).to.equal(null);
    }
  });
});

describe('toUplotData', () => {
  const series = [
    { label: 'USGS', data: [{ x: '2024-01-01 00:00:00', y: 1 }, { x: '2024-01-01 01:00:00', y: 2 }] },
    { label: 'Sim', data: [{ x: '2024-01-01 00:00:00', y: 10 }, { x: '2024-01-01 01:00:00', y: 20 }] },
  ];

  it('produces column arrays aligned on time', () => {
    const { data, labels, points } = toUplotData(series);
    expect(labels).to.deep.equal(['USGS', 'Sim']);
    expect(points).to.equal(2);
    expect(data).to.have.lengthOf(3); // xs + two y columns
    expect(data[1]).to.deep.equal([1, 2]);
    expect(data[2]).to.deep.equal([10, 20]);
  });

  it('sorts by time regardless of payload order', () => {
    const out = toUplotData([
      { label: 'a', data: [{ x: '2024-01-02 00:00:00', y: 2 }, { x: '2024-01-01 00:00:00', y: 1 }] },
    ]);
    expect(out.data[1]).to.deep.equal([1, 2]);
    expect(out.data[0][0]).to.be.lessThan(out.data[0][1]);
  });

  // Series can cover different spans, so misaligning them plots wrong times.
  it('aligns series with differing timestamps, leaving gaps null', () => {
    const out = toUplotData([
      { label: 'a', data: [{ x: '2024-01-01 00:00:00', y: 1 }] },
      { label: 'b', data: [{ x: '2024-01-01 01:00:00', y: 5 }] },
    ]);
    expect(out.points).to.equal(2);
    expect(out.data[1]).to.deep.equal([1, null]);
    expect(out.data[2]).to.deep.equal([null, 5]);
  });

  it('drops points with unparseable timestamps', () => {
    const out = toUplotData([
      { label: 'a', data: [{ x: 'garbage', y: 1 }, { x: '2024-01-01 00:00:00', y: 2 }] },
    ]);
    expect(out.points).to.equal(1);
    expect(out.data[1]).to.deep.equal([2]);
  });

  // A null y is a real gap in the record; NaN would blank the series in uPlot.
  it('normalises non-numeric values to null', () => {
    const out = toUplotData([
      { label: 'a', data: [{ x: '2024-01-01 00:00:00', y: null }, { x: '2024-01-01 01:00:00', y: 'nope' }] },
    ]);
    expect(out.data[1]).to.deep.equal([null, null]);
  });

  it('accepts numeric strings', () => {
    const out = toUplotData([{ label: 'a', data: [{ x: '2024-01-01 00:00:00', y: '3.5' }] }]);
    expect(out.data[1]).to.deep.equal([3.5]);
  });

  it('returns an empty shape for empty or malformed input', () => {
    for (const bad of [null, undefined, [], [{}], [{ label: 'x' }]]) {
      const out = toUplotData(bad);
      expect(out.points, JSON.stringify(bad)).to.equal(0);
    }
  });

  it('falls back to a positional label when one is missing', () => {
    const out = toUplotData([{ data: [{ x: '2024-01-01 00:00:00', y: 1 }] }]);
    expect(out.labels).to.deep.equal(['series 1']);
  });
});

// Number(null), Number('') and Number([]) are all 0: each would plot as zero flow.
describe('toUplotData zero-coercion guards', () => {
  it('never turns a gap into zero', () => {
    const out = toUplotData([
      { label: 'a', data: [
        { x: '2024-01-01 00:00:00', y: null },
        { x: '2024-01-01 01:00:00', y: '' },
        { x: '2024-01-01 02:00:00', y: [] },
        { x: '2024-01-01 03:00:00', y: undefined },
        { x: '2024-01-01 04:00:00', y: 0 },
      ] },
    ]);
    // Only the genuine zero survives as zero.
    expect(out.data[1]).to.deep.equal([null, null, null, null, 0]);
  });
});
