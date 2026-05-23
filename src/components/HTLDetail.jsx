import { updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from '../lib/collections';
import { wouldHtlCycle } from '../lib/htl';
import MultiSelect from './MultiSelect';

// ----- expanded view for one HTL: its GTL/HTL tree + applicable aircraft -----

export default function HTLDetail({
  htl,
  htls,
  gtls,
  aircraft,
  htlById,
  gtlById,
  aircraftById,
  opCountByGtl,
  isAdmin,
}) {
  const htlRef = doc(db, COLLECTIONS.HTL, htl.id);
  const children = Array.isArray(htl.children) ? htl.children : [];
  const acIds = htl.aircraftIds || [];

  // ----- inline edit for the HTL reference -----
  async function updateHtlRef(value) {
    const v = (value || '').trim();
    if (!v || v === htl.htlRef) return;
    await updateDoc(htlRef, { htlRef: v });
  }

  const gtlChildIds = new Set(
    children.filter((c) => c.type === 'gtl').map((c) => c.id)
  );
  const htlChildIds = new Set(
    children.filter((c) => c.type === 'htl').map((c) => c.id)
  );

  // GTLs can always be added. HTLs are filtered to avoid self-reference and
  // loops (an HTL cannot contain something that already contains it).
  const addableGtls = gtls.filter((g) => !gtlChildIds.has(g.id));
  const addableHtls = htls.filter(
    (h) =>
      h.id !== htl.id &&
      !htlChildIds.has(h.id) &&
      !wouldHtlCycle(htl.id, h.id, htlById)
  );

  async function addGtlChildren(ids) {
    await updateDoc(htlRef, {
      children: [...children, ...ids.map((id) => ({ type: 'gtl', id }))],
    });
  }

  async function addHtlChildren(ids) {
    await updateDoc(htlRef, {
      children: [...children, ...ids.map((id) => ({ type: 'htl', id }))],
    });
  }

  async function removeChild(type, id) {
    await updateDoc(htlRef, {
      children: children.filter((c) => !(c.type === type && c.id === id)),
    });
  }

  const addableAircraft = aircraft.filter((a) => !acIds.includes(a.id));

  async function addAircrafts(ids) {
    await updateDoc(htlRef, { aircraftIds: [...acIds, ...ids] });
  }

  async function removeAircraft(id) {
    await updateDoc(htlRef, {
      aircraftIds: acIds.filter((x) => x !== id),
    });
  }

  return (
    <div className="detail-panel">
      {isAdmin && (
        <div className="detail-section">
          <p className="detail-section-title">Details</p>
          <div className="form-row">
            <div className="field">
              <label>HTL reference</label>
              <input
                className="input mono"
                defaultValue={htl.htlRef}
                key={'r' + htl.htlRef}
                onBlur={(e) => updateHtlRef(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* ---- the GTL / HTL tree ---- */}
      <div className="detail-section">
        <p className="detail-section-title">Contents of {htl.htlRef}</p>

        {children.length === 0 ? (
          <p className="kit-empty">No GTLs or HTLs added yet.</p>
        ) : (
          <HTLChildTree
            items={children}
            htlById={htlById}
            gtlById={gtlById}
            opCountByGtl={opCountByGtl}
            seen={new Set([htl.id])}
            onRemove={isAdmin ? removeChild : null}
          />
        )}

        {isAdmin && (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <MultiSelect
              placeholder="Add GTLs…"
              onAdd={addGtlChildren}
              options={addableGtls.map((g) => ({
                id: g.id,
                label: g.gtlRef,
                sublabel: `${opCountByGtl.get(g.id) || 0} operations`,
              }))}
            />
            <MultiSelect
              placeholder="Add HTLs…"
              onAdd={addHtlChildren}
              options={addableHtls.map((h) => ({
                id: h.id,
                label: h.htlRef,
                sublabel: `${(h.children || []).length} items`,
              }))}
            />
          </div>
        )}
      </div>

      {/* ---- applicable aircraft ---- */}
      <div className="detail-section">
        <p className="detail-section-title">Applies to aircraft</p>

        {acIds.length === 0 ? (
          <p className="kit-empty">No aircraft added yet.</p>
        ) : (
          <div className="chip-row">
            {acIds.map((id) => {
              const a = aircraftById.get(id);
              return (
                <span key={id} className="chip">
                  <span className="mono">
                    {a ? a.registration : '(missing)'}
                  </span>
                  {isAdmin && (
                    <button
                      className="chip-x"
                      onClick={() => removeAircraft(id)}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {isAdmin && (
          <MultiSelect
            placeholder="Add aircraft…"
            onAdd={addAircrafts}
            options={addableAircraft.map((a) => ({
              id: a.id,
              label: a.registration,
              sublabel: a.fleetType || '',
            }))}
          />
        )}
      </div>
    </div>
  );
}

// ----- recursive tree of an HTL's children (GTLs are leaves, HTLs nest) -----

function HTLChildTree({ items, htlById, gtlById, opCountByGtl, seen, onRemove }) {
  return (
    <ul className="kit-tree">
      {items.map((child) => {
        if (child.type === 'gtl') {
          const g = gtlById.get(child.id);
          return (
            <li key={'g' + child.id} className="kit-node">
              <div className="kit-node-row">
                <span className="tag tag-part">GTL</span>
                <span className="mono strong">
                  {g ? g.gtlRef : '(missing GTL)'}
                </span>
                {g && (
                  <span className="kit-desc">
                    {opCountByGtl.get(g.id) || 0} operations
                  </span>
                )}
                {onRemove && (
                  <button
                    className="kit-remove"
                    onClick={() => onRemove('gtl', child.id)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          );
        }

        // type === 'htl'
        const h = htlById.get(child.id);
        if (!h) {
          return (
            <li key={'h' + child.id} className="kit-node">
              <div className="kit-node-row">
                <span className="tag tag-kit">HTL</span>
                <span className="mono strong">(missing HTL)</span>
                {onRemove && (
                  <button
                    className="kit-remove"
                    onClick={() => onRemove('htl', child.id)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          );
        }

        const isCycle = seen.has(h.id);
        const childSeen = new Set(seen);
        childSeen.add(h.id);
        const grandChildren = Array.isArray(h.children) ? h.children : [];

        return (
          <li key={'h' + child.id} className="kit-node">
            <div className="kit-node-row">
              <span className="tag tag-kit">HTL</span>
              <span className="mono strong">{h.htlRef}</span>
              {isCycle && (
                <span className="cycle-flag">circular — not expanded</span>
              )}
              {onRemove && (
                <button
                  className="kit-remove"
                  onClick={() => onRemove('htl', child.id)}
                  aria-label="Remove"
                >
                  ×
                </button>
              )}
            </div>
            {!isCycle && grandChildren.length > 0 && (
              <HTLChildTree
                items={grandChildren}
                htlById={htlById}
                gtlById={gtlById}
                opCountByGtl={opCountByGtl}
                seen={childSeen}
                onRemove={null}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
