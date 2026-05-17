import { useState, useMemo } from 'react';
import { parseBatchText } from '../lib/batch';

// Reusable bulk-input panel. Paste rows, preview what was parsed, import.
//
// Props:
//   fields      — [{ key, label, required }]  columns, in the order they're pasted
//   noun        — e.g. "aircraft" (used in the buttons and messages)
//   onImport    — async (rows) => void   rows = objects keyed by field.key (valid rows only)
//   validateRow — optional (rowObj) => string | null   extra per-row check
export default function BatchInput({ fields, noun, onImport, validateRow }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  // Parse and validate on every keystroke.
  const rows = useMemo(() => {
    return parseBatchText(text).map((cells) => {
      const obj = {};
      fields.forEach((f, i) => {
        obj[f.key] = cells[i] || '';
      });
      let problem = null;
      for (const f of fields) {
        if (f.required && !obj[f.key]) {
          problem = `${f.label} is required`;
          break;
        }
      }
      if (!problem && validateRow) problem = validateRow(obj) || null;
      return { obj, problem };
    });
  }, [text, fields, validateRow]);

  const valid = rows.filter((r) => !r.problem);
  const invalidCount = rows.length - valid.length;
  const formatHint = fields
    .map((f) => f.label + (f.required ? '*' : ''))
    .join(', ');

  async function handleImport() {
    if (valid.length === 0) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await onImport(valid.map((r) => r.obj));
      setDone(`Imported ${valid.length} ${noun}.`);
      setText('');
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="batch-bar">
        <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(true); setDone(null); }}>
          Bulk add…
        </button>
        {done && <span className="batch-done">{done}</span>}
      </div>
    );
  }

  return (
    <div className="batch-panel">
      <div className="batch-head">
        <h3 className="batch-title">Bulk add {noun}</h3>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { setOpen(false); setText(''); setError(null); }}
        >
          Cancel
        </button>
      </div>

      <p className="batch-hint">
        One per line: <strong>{formatHint}</strong>. Separate columns with a
        comma or a tab — you can paste straight from Excel. (* = required)
      </p>

      <textarea
        className="batch-textarea"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={fields.map((f) => f.label).join(', ')}
      />

      {rows.length > 0 && (
        <div className="batch-preview">
          <table className="table batch-table">
            <thead>
              <tr>
                <th className="col-caret">#</th>
                {fields.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.problem ? 'batch-bad' : ''}>
                  <td className="dim">{i + 1}</td>
                  {fields.map((f) => (
                    <td key={f.key}>
                      {r.obj[f.key] || <span className="dim">—</span>}
                    </td>
                  ))}
                  <td>
                    {r.problem ? (
                      <span className="batch-status-bad">{r.problem}</span>
                    ) : (
                      <span className="batch-status-ok">ready</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invalidCount > 0 && (
        <p className="notice">
          {invalidCount} row{invalidCount === 1 ? '' : 's'} ha
          {invalidCount === 1 ? 's' : 've'} a problem and will be skipped.
        </p>
      )}
      {error && <p className="notice notice-error">{error}</p>}

      <button
        className="btn btn-primary"
        onClick={handleImport}
        disabled={busy || valid.length === 0}
      >
        {busy ? 'Importing…' : `Import ${valid.length} ${noun}`}
      </button>
    </div>
  );
}
