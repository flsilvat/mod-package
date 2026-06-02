// Small display helpers.

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Format an ISO date string ("YYYY-MM-DD", as produced by <input type="date">)
// as "10-May-2026". Parses the parts directly so there's no timezone shift.
// Returns '' for empty input, and the original string if it isn't an ISO date.
export function formatDateDMY(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, year, month, day] = m;
  const name = MONTHS[Number(month) - 1];
  if (!name) return iso;
  return `${day}-${name}-${year}`;
}
