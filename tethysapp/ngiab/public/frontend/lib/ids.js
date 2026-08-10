/**
 * Identifier helpers shared by the map and the search.
 *
 * The API speaks in prefixed strings (`"cat-1234"`); the pmtiles archives store bare
 * numbers. Everything crossing that boundary goes through here.
 */

/**
 * Coerce API ids to the numeric form the vector tiles use.
 *
 * Unparseable entries are dropped rather than becoming `NaN`: a NaN in a MapLibre filter
 * matches nothing and produces an empty map with no error, which is indistinguishable from
 * a broken one.
 *
 * @param {ReadonlyArray<string|number>|unknown} ids
 * @returns {number[]} finite numbers only, in input order
 */
export function toNumericIds(ids) {
  if (!Array.isArray(ids)) return [];

  const out = [];
  for (const raw of ids) {
    if (typeof raw === 'number') {
      if (Number.isFinite(raw)) out.push(raw);
      continue;
    }
    if (typeof raw !== 'string') continue;

    // Strip the "cat-" style prefix, then require digits to remain. Without that check,
    // stripping leading non-digits from "nonsense" (or "null", or "[object Object]")
    // leaves "", and Number("") is 0 — so every unparseable id quietly became catchment 0
    // and filtered the map to a real feature that was never asked for.
    const digits = raw.replace(/^\D+/, '');
    if (!/^\d/.test(digits)) continue;

    const n = Number(digits);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Build the search index from the run's catchment list.
 *
 * Keeps the original label alongside the numeric id: the label is what the user types and
 * what the time-series endpoints expect, the number is what the tiles filter on.
 *
 * @param {ReadonlyArray<string>|unknown} labels
 * @returns {Array<{label: string, numeric: number}>}
 */
export function toCatchmentIndex(labels) {
  if (!Array.isArray(labels)) return [];

  const index = [];
  for (const label of labels) {
    const [numeric] = toNumericIds([label]);
    if (numeric !== undefined) index.push({ label: String(label), numeric });
  }
  return index;
}

/** Rank exact matches first, then prefix, then substring. */
const SEARCH_LIMIT = 25;

/**
 * Match catchments against a query, best first.
 *
 * Scans the whole index deliberately: a few thousand string compares is microseconds, and
 * exiting early can skip an exact match that happens to sort after the limit's worth of
 * substring hits.
 *
 * @param {ReadonlyArray<{label: string, numeric: number}>} index
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<{label: string, numeric: number}>}
 */
export function searchCatchments(index, query, limit = SEARCH_LIMIT) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q || !Array.isArray(index)) return [];

  const exact = [];
  const prefix = [];
  const contains = [];

  for (const entry of index) {
    const label = entry.label.toLowerCase();
    if (label === q) exact.push(entry);
    else if (label.startsWith(q) || String(entry.numeric).startsWith(q)) prefix.push(entry);
    else if (label.includes(q)) contains.push(entry);
  }

  return [...exact, ...prefix, ...contains].slice(0, limit);
}
