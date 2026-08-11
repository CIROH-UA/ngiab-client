export function toNumericIds(ids) {
  if (!Array.isArray(ids)) return [];

  const out = [];
  for (const raw of ids) {
    if (typeof raw === 'number') {
      if (Number.isFinite(raw)) out.push(raw);
      continue;
    }
    if (typeof raw !== 'string') continue;

    // Require digits after stripping the prefix: Number('') is 0, not NaN.
    const digits = raw.replace(/^\D+/, '');
    if (!/^\d/.test(digits)) continue;

    const n = Number(digits);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function toCatchmentIndex(labels) {
  if (!Array.isArray(labels)) return [];

  const index = [];
  for (const label of labels) {
    const [numeric] = toNumericIds([label]);
    if (numeric !== undefined) index.push({ label: String(label), numeric });
  }
  return index;
}

const SEARCH_LIMIT = 25;

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
