import { useMemo } from 'react';
import { useScope } from '../lib/scope';
import MultiSelect from './MultiSelect';

// The scope bar — a thin strip at the top of entity pages. Shows the
// currently-selected TO Parts as removable chips, plus a picker to add
// more. When nothing is selected the bar shows "all entities" and only the
// picker — pages then show everything as they always have.

export default function ScopeBar() {
  const {
    items,
    addItem,
    removeItem,
    clear,
    toParts,
    toPartsById,
    configsById,
    sbsById,
    tosById,
  } = useScope();

  // TO Parts not already selected, labeled "TO {n} · {partLabel}" with
  // "{configName} · {sbRef}" as a sublabel — sorted by TO number then part.
  const options = useMemo(() => {
    const selected = new Set(items.map((i) => i.id));
    const list = [];
    for (const p of toParts) {
      if (selected.has(p.id)) continue;
      const to = tosById.get(p.technicalOrderId);
      const config = configsById.get(p.sbConfigId);
      const sb = config ? sbsById.get(config.sbId) : null;
      list.push({
        id: p.id,
        label: `TO ${to?.toNumber ?? '?'} · ${p.partLabel}`,
        sublabel: config
          ? `${config.name}${sb ? ` · ${sb.sbRef}` : ''}`
          : '(no config assigned)',
        sortKey: `${to?.toNumber ?? ''} ${p.partLabel}`.toLowerCase(),
      });
    }
    list.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    return list;
  }, [toParts, items, tosById, configsById, sbsById]);

  return (
    <div className="scope-bar">
      <span className="scope-label">Scope</span>
      {items.length === 0 ? (
        <span className="scope-empty">all entities</span>
      ) : (
        items.map((item) => {
          const part = toPartsById.get(item.id);
          const to = part ? tosById.get(part.technicalOrderId) : null;
          return (
            <span key={item.id} className="chip">
              <span className="mono">TO {to?.toNumber ?? '?'}</span>
              <span className="dim">
                {part?.partLabel ?? '(missing TO Part)'}
              </span>
              <button
                className="chip-x"
                onClick={() => removeItem(item.id)}
                aria-label="Remove"
              >
                ×
              </button>
            </span>
          );
        })
      )}
      <div className="scope-add">
        <MultiSelect
          placeholder={
            items.length === 0
              ? 'Narrow by TO Part…'
              : 'Add another TO Part…'
          }
          onAdd={(ids) =>
            ids.forEach((id) => addItem({ kind: 'toPart', id }))
          }
          options={options}
        />
      </div>
      {items.length > 0 && (
        <button className="btn btn-ghost btn-sm" onClick={clear}>
          Clear scope
        </button>
      )}
    </div>
  );
}
