import { useState, useMemo, useRef, useEffect } from 'react';

// Searchable checkbox multi-select used for linking sub-entities.
//
// Props:
//   options     — [{ id, label, sublabel }]  the items that can be added
//   placeholder — button text, e.g. "Add materials…"
//   onAdd       — (ids[]) => void   called with the ticked ids on confirm
//
// Keyboard: open it, type to filter, Up/Down to move the highlight,
// Enter to tick the highlighted row, Escape to close, then the Add button.
export default function MultiSelect({ options, placeholder, onAdd }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState(() => new Set());
  const [highlight, setHighlight] = useState(0);

  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel || '').toLowerCase().includes(q)
    );
  }, [options, search]);

  // Keep the highlight within range as the visible list changes.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  // Focus the search box when the panel opens.
  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  // Close when clicking outside the component.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function openPanel() {
    setSearch('');
    setChecked(new Set());
    setHighlight(0);
    setOpen(true);
  }

  function toggle(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirm() {
    if (checked.size === 0) return;
    onAdd([...checked]);
    setOpen(false);
  }

  function onSearchKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = visible[highlight];
      if (opt) toggle(opt.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="multiselect" ref={rootRef}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => (open ? setOpen(false) : openPanel())}
        disabled={options.length === 0}
      >
        {options.length === 0 ? 'Nothing to add' : placeholder || 'Add…'}
      </button>

      {open && (
        <div className="ms-panel">
          <input
            ref={searchRef}
            type="text"
            className="input ms-search"
            placeholder="Search…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onSearchKeyDown}
          />

          <div className="ms-list" ref={listRef}>
            {visible.length === 0 ? (
              <p className="ms-empty">No matches.</p>
            ) : (
              visible.map((o, i) => (
                <label
                  key={o.id}
                  className={'ms-option' + (i === highlight ? ' is-highlight' : '')}
                  onMouseEnter={() => setHighlight(i)}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(o.id)}
                    onChange={() => toggle(o.id)}
                    tabIndex={-1}
                  />
                  <span className="ms-label">{o.label}</span>
                  {o.sublabel && (
                    <span className="ms-sublabel">{o.sublabel}</span>
                  )}
                </label>
              ))
            )}
          </div>

          <div className="ms-foot">
            <span className="ms-count">{checked.size} selected</span>
            <div className="ms-foot-btns">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={confirm}
                disabled={checked.size === 0}
              >
                Add{checked.size > 0 ? ` ${checked.size}` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
