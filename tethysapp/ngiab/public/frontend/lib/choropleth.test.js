import { expect } from '@esm-bundle/chai';
import {
  NO_DATA_BIN,
  RAMP,
  decodeBins,
  frameAt,
  diffFrames,
  binColor,
  legendEntries,
  legendLabel,
  formatBreak,
  formatFrameTime,
} from './choropleth.js';

const encode = (bytes) => btoa(String.fromCharCode(...bytes));

describe('decodeBins', () => {
  it('round-trips the base64 the backend sends', () => {
    expect(Array.from(decodeBins(encode([0, 1, 8, 255])))).to.deep.equal([0, 1, 8, 255]);
  });

  it('treats an absent matrix as empty rather than throwing', () => {
    expect(decodeBins('').length).to.equal(0);
    expect(decodeBins(undefined).length).to.equal(0);
  });
});

describe('frameAt', () => {
  const bins = decodeBins(encode([1, 2, 3, 4, 5, 6]));

  it('slices the row for a timestep out of the row-major matrix', () => {
    expect(Array.from(frameAt(bins, 2, 3, 0))).to.deep.equal([1, 2, 3]);
    expect(Array.from(frameAt(bins, 2, 3, 1))).to.deep.equal([4, 5, 6]);
  });

  it('returns empty outside the frame range instead of reading past the end', () => {
    expect(frameAt(bins, 2, 3, 2).length).to.equal(0);
    expect(frameAt(bins, 2, 3, -1).length).to.equal(0);
  });
});

describe('diffFrames', () => {
  it('reports only the catchments whose class changed', () => {
    const previous = Uint8Array.from([1, 2, 3]);
    const next = Uint8Array.from([1, 5, 3]);
    expect(diffFrames(previous, next)).to.deep.equal([1]);
  });

  it('reports every catchment on the first frame', () => {
    expect(diffFrames(null, Uint8Array.from([4, 4]))).to.deep.equal([0, 1]);
  });
});

describe('binColor', () => {
  // The whole point of reserving bin 0: no-data must not read as the lowest class.
  it('renders no-data transparent, not as the first class', () => {
    expect(binColor(NO_DATA_BIN, 'light')).to.equal('rgba(0,0,0,0)');
    expect(binColor(1, 'light')).to.not.equal(binColor(NO_DATA_BIN, 'light'));
  });

  it('uses a different ramp per theme', () => {
    expect(binColor(1, 'dark')).to.equal(RAMP.dark[1]);
    expect(binColor(1, 'light')).to.equal(RAMP.light[1]);
  });

  it('falls back to transparent for a bin beyond the ramp', () => {
    expect(binColor(99, 'light')).to.equal('rgba(0,0,0,0)');
  });
});

describe('legendEntries', () => {
  // A zero-heavy variable collapses to few classes; eight would invent impossible ones.
  it('draws one swatch per class the backend actually produced', () => {
    expect(legendEntries([1, 2], 'light')).to.have.length(3);
    expect(legendEntries([1, 2, 3, 4, 5, 6, 7], 'light')).to.have.length(8);
  });

  it('handles a variable with a single class', () => {
    const entries = legendEntries([], 'light');
    expect(entries).to.have.length(1);
    expect(legendLabel(entries[0])).to.equal('all values');
  });
});

describe('legendLabel', () => {
  it('leaves the outer classes open-ended', () => {
    const entries = legendEntries([10, 20], 'light');
    expect(legendLabel(entries[0])).to.equal('< 10');
    expect(legendLabel(entries[1])).to.equal('10 - 20');
    expect(legendLabel(entries[2])).to.equal('≥ 20');
  });
});

describe('formatBreak', () => {
  // Values differ by orders of magnitude, so fixed decimals are unreadable at one end.
  it('uses exponential notation for very small values', () => {
    expect(formatBreak(0.0000287)).to.equal('2.87e-5');
  });

  it('keeps ordinary values readable', () => {
    expect(formatBreak(12.3456)).to.equal('12.3');
    expect(formatBreak(0)).to.equal('0');
  });

  it('returns empty for a missing break rather than NaN', () => {
    expect(formatBreak(undefined)).to.equal('');
    expect(formatBreak(null)).to.equal('');
  });
});

describe('formatFrameTime', () => {
  it('drops a midnight time so a daily run reads as dates', () => {
    expect(formatFrameTime('2017-01-01T00:00:00')).to.equal('2017-01-01');
  });

  it('keeps the time when the step is sub-daily', () => {
    expect(formatFrameTime('2017-01-01T06:00:00')).to.equal('2017-01-01 06:00');
  });

  it('accepts the space-separated form too', () => {
    expect(formatFrameTime('2017-01-01 06:00:00')).to.equal('2017-01-01 06:00');
  });

  // The displayed hour must match the string byte for byte, whatever the viewer's zone.
  it('does not shift the stamp into the viewer timezone', () => {
    expect(formatFrameTime('2017-06-15T06:00:00')).to.contain('06:00');
    expect(formatFrameTime('2017-06-15T23:00:00')).to.equal('2017-06-15 23:00');
  });

  it('returns the input unchanged when it is not a timestamp', () => {
    expect(formatFrameTime('not a time')).to.equal('not a time');
  });
});
