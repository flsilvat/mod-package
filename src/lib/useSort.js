import { useState, useMemo } from 'react';

// Compare two scalar values for sorting. Empty/null/undefined always sink to
// the end of the natural sort, so they don't crowd the top of the table when
// the user is scanning real data. Strings use locale compare with numeric
// awareness ("PN-10" comes after "PN-2", not before).
function compareValues(a, b) {
  const aEmpty = a == null || a === '';
  const bEmpty = b == null || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }
  // mixed / booleans — fall back to string compare
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

// useSort — table column sort state + sorted list.
//
//   items       — the array to sort (already scope-/text-filtered).
//   columns     — { key: (item) => sortable-value }. Must be memoized by the
//                 caller, otherwise the sort recomputes every render.
//   defaultKey  — initial sort column (e.g. 'partNumber').
//   defaultDir  — 'asc' (default) or 'desc'.
//
// Returns { sorted, sortKey, sortDir, toggle }.
//   toggle(key) — first click sorts asc; second click on the same column
//   toggles to desc; click on a different column starts asc on that one.
export function useSort(items, columns, defaultKey = null, defaultDir = 'asc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  function toggle(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return items;
    const getValue = columns[sortKey];
    if (typeof getValue !== 'function') return items;
    const out = [...items].sort((a, b) =>
      compareValues(getValue(a), getValue(b))
    );
    if (sortDir === 'desc') out.reverse();
    return out;
  }, [items, sortKey, sortDir, columns]);

  return { sorted, sortKey, sortDir, toggle };
}
