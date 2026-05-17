// Reusable quick-filter input. The page holds the filter text and does the
// actual filtering; this is just the styled input and a small result count.
export default function FilterBar({ value, onChange, placeholder, count, total }) {
  return (
    <div className="filterbar">
      <input
        type="search"
        className="input filterbar-input"
        placeholder={placeholder || 'Filter…'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder || 'Filter'}
      />
      {value.trim() && (
        <span className="filterbar-count">
          {count} / {total}
        </span>
      )}
    </div>
  );
}
