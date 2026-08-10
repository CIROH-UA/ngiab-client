import { expect } from '@esm-bundle/chai';
import { toNumericIds, toCatchmentIndex, searchCatchments } from './ids.js';

describe('toNumericIds', () => {
  it('strips the API prefix', () => {
    expect(toNumericIds(['cat-1015', 'cat-2863848'])).to.deep.equal([1015, 2863848]);
  });

  it('passes numbers through', () => {
    expect(toNumericIds([1015, 42])).to.deep.equal([1015, 42]);
  });

  // NaN in a MapLibre filter matches nothing and raises no error, so a bad id must be
  // dropped rather than silently poisoning the layer.
  it('drops unparseable entries instead of producing NaN', () => {
    expect(toNumericIds(['cat-1015', 'nonsense', null, undefined, {}])).to.deep.equal([1015]);
  });

  it('returns empty for non-arrays', () => {
    for (const bad of [null, undefined, 'cat-1', 42, {}]) {
      expect(toNumericIds(bad), String(bad)).to.deep.equal([]);
    }
  });
});

describe('toCatchmentIndex', () => {
  it('keeps the label alongside the numeric id', () => {
    expect(toCatchmentIndex(['cat-1015'])).to.deep.equal([{ label: 'cat-1015', numeric: 1015 }]);
  });

  it('skips entries with no usable number', () => {
    expect(toCatchmentIndex(['cat-1', 'bad'])).to.have.lengthOf(1);
  });

  it('returns empty for non-arrays', () => {
    expect(toCatchmentIndex(null)).to.deep.equal([]);
  });
});

describe('searchCatchments', () => {
  const index = toCatchmentIndex([
    'cat-1', 'cat-10', 'cat-101', 'cat-1015', 'cat-2460', 'cat-51015',
  ]);

  it('ranks an exact match first', () => {
    expect(searchCatchments(index, 'cat-1015')[0].label).to.equal('cat-1015');
  });

  it('matches on the bare number as a prefix', () => {
    expect(searchCatchments(index, '1015')[0].label).to.equal('cat-1015');
  });

  it('still finds substring-only matches, after the prefixes', () => {
    const labels = searchCatchments(index, '1015').map((e) => e.label);
    expect(labels).to.include('cat-51015');
    expect(labels.indexOf('cat-1015')).to.be.lessThan(labels.indexOf('cat-51015'));
  });

  it('is case insensitive', () => {
    expect(searchCatchments(index, 'CAT-101')).to.have.length.greaterThan(0);
  });

  it('returns nothing for an empty or whitespace query', () => {
    expect(searchCatchments(index, '')).to.deep.equal([]);
    expect(searchCatchments(index, '   ')).to.deep.equal([]);
  });

  it('returns nothing when no id matches', () => {
    expect(searchCatchments(index, 'zzz')).to.deep.equal([]);
  });

  it('honours the limit', () => {
    expect(searchCatchments(index, 'cat-', 2)).to.have.lengthOf(2);
  });

  // Bailing out early once the limit is reached would skip an exact match that happens to
  // sort after a limit's worth of substring hits.
  it('finds an exact match beyond the limit position', () => {
    const many = toCatchmentIndex([
      ...Array.from({ length: 60 }, (_, i) => `cat-${1000 + i}0`),
      'cat-7',
    ]);
    expect(searchCatchments(many, 'cat-7')[0].label).to.equal('cat-7');
  });
});
