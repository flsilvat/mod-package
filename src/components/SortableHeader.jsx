// Header cell for sortable table columns. Renders the label as a small,
// header-styled button; shows an arrow on the column that's currently the
// sort key. Pass the trio { sortKey, sortDir, onToggle } from useSort, plus
// the column key and label for this cell.

export default function SortableHeader({
  label,
  column,
  sortKey,
  sortDir,
  onToggle,
  className = '',
  ...thProps
}) {
  const isActive = sortKey === column;
  const arrow = isActive ? (sortDir === 'asc' ? '↑' : '↓') : '';
  return (
    <th className={className} {...thProps}>
      <button
        type="button"
        className={'th-sort' + (isActive ? ' is-active' : '')}
        onClick={() => onToggle(column)}
        aria-label={`Sort by ${label}`}
      >
        <span>{label}</span>
        <span className="th-sort-arrow" aria-hidden="true">
          {arrow}
        </span>
      </button>
    </th>
  );
}
