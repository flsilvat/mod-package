import { useState, useEffect, useMemo, Fragment } from 'react';
import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from '../lib/collections';
import { useAuth } from '../lib/auth';
import { wouldCreateCycle } from '../lib/materials';

export default function MaterialsPage() {
  const { isAdmin } = useAuth();

  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add form
  const [partNumber, setPartNumber] = useState('');
  const [description, setDescription] = useState('');
  const [isKit, setIsKit] = useState(false);
  const [saving, setSaving] = useState(false);

  // Which kit rows are expanded
  const [expanded, setExpanded] = useState(() => new Set());

  // Live list of every material
  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.MATERIAL),
      orderBy('partNumber')
    );
    return onSnapshot(
      q,
      (snap) => {
        setMaterials(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
  }, []);

  // Fast lookup by id — needed to resolve component references into a tree.
  const byId = useMemo(() => {
    const map = new Map();
    for (const m of materials) map.set(m.id, m);
    return map;
  }, [materials]);

  async function handleAdd(event) {
    event.preventDefault();
    const pn = partNumber.trim();
    if (!pn) return;
    // Part numbers identify a material — don't allow an exact duplicate.
    if (materials.some((m) => m.partNumber.toLowerCase() === pn.toLowerCase())) {
      setError(`A material with part number "${pn}" already exists.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addDoc(collection(db, COLLECTIONS.MATERIAL), {
        partNumber: pn,
        description: description.trim(),
        isKit,
        components: [],
        createdAt: serverTimestamp(),
      });
      setPartNumber('');
      setDescription('');
      setIsKit(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(material) {
    const usedIn = materials.filter(
      (m) =>
        m.isKit &&
        (m.components || []).some((c) => c.materialId === material.id)
    );
    const message = usedIn.length
      ? `"${material.partNumber}" is used in ${usedIn.length} kit(s). ` +
        `Deleting it will leave broken references. Delete anyway?`
      : `Delete material "${material.partNumber}"?`;
    if (!window.confirm(message)) return;
    setError(null);
    try {
      await deleteDoc(doc(db, COLLECTIONS.MATERIAL, material.id));
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addComponent(kit, materialId, qty) {
    const next = [...(kit.components || []), { materialId, qty }];
    await updateDoc(doc(db, COLLECTIONS.MATERIAL, kit.id), {
      components: next,
    });
  }

  async function removeComponent(kit, index) {
    const next = (kit.components || []).filter((_, i) => i !== index);
    await updateDoc(doc(db, COLLECTIONS.MATERIAL, kit.id), {
      components: next,
    });
  }

  const colSpan = isAdmin ? 5 : 4;

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Entity</p>
        <h1>Materials</h1>
        <p className="lede">
          Parts and kits. A kit contains other materials — and those may be
          kits too, so a kit can nest several levels deep.
        </p>
      </div>

      {isAdmin && (
        <section className="panel">
          <h2 className="panel-title">Add a material</h2>
          <form className="form-row" onSubmit={handleAdd}>
            <div className="field">
              <label htmlFor="pn">Part number</label>
              <input
                id="pn"
                className="input mono"
                placeholder="ABC-12345"
                value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="field field-wide">
              <label htmlFor="desc">Description</label>
              <input
                id="desc"
                className="input"
                placeholder="Bracket assembly, LH"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoComplete="off"
              />
            </div>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={isKit}
                onChange={(e) => setIsKit(e.target.checked)}
              />
              <span>This is a kit</span>
            </label>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add material'}
            </button>
          </form>
          {error && <p className="notice notice-error">{error}</p>}
        </section>
      )}

      <section className="panel">
        <div className="panel-titlebar">
          <h2 className="panel-title">Catalogue</h2>
          <span className="count">{materials.length}</span>
        </div>

        {loading ? (
          <p className="notice">Loading…</p>
        ) : materials.length === 0 ? (
          <p className="notice">
            No materials yet.
            {isAdmin
              ? ' Add the first one with the form above.'
              : ' An admin can add the first one.'}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="col-caret" />
                <th>Part number</th>
                <th>Description</th>
                <th>Type</th>
                {isAdmin && <th className="col-action" />}
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => {
                const componentCount = (m.components || []).length;
                const isOpen = expanded.has(m.id);
                return (
                  <Fragment key={m.id}>
                    <tr>
                      <td className="col-caret">
                        {m.isKit && (
                          <button
                            className="expand-btn"
                            onClick={() => toggleExpand(m.id)}
                            aria-label={isOpen ? 'Collapse' : 'Expand'}
                          >
                            {isOpen ? '▾' : '▸'}
                          </button>
                        )}
                      </td>
                      <td className="mono strong">{m.partNumber}</td>
                      <td>
                        {m.description || <span className="dim">—</span>}
                      </td>
                      <td>
                        {m.isKit ? (
                          <span className="tag tag-kit">
                            kit · {componentCount}
                          </span>
                        ) : (
                          <span className="tag tag-part">part</span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="col-action">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleDelete(m)}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                    {m.isKit && isOpen && (
                      <tr className="detail-row">
                        <td colSpan={colSpan}>
                          <KitDetail
                            kit={m}
                            byId={byId}
                            materials={materials}
                            isAdmin={isAdmin}
                            onAddComponent={addComponent}
                            onRemoveComponent={removeComponent}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {!isAdmin && !loading && (
          <p className="notice viewer-note">
            You have viewer access — read-only.
          </p>
        )}
      </section>
    </div>
  );
}

// ----- the expanded view for one kit -----

function KitDetail({
  kit,
  byId,
  materials,
  isAdmin,
  onAddComponent,
  onRemoveComponent,
}) {
  const [selectedId, setSelectedId] = useState('');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const components = kit.components || [];

  // Materials that can be added: not the kit itself, not already in it, and
  // not anything that would close a loop.
  const alreadyIn = new Set(components.map((c) => c.materialId));
  const addable = materials.filter(
    (m) =>
      m.id !== kit.id &&
      !alreadyIn.has(m.id) &&
      !wouldCreateCycle(kit.id, m.id, byId)
  );

  async function handleAdd(event) {
    event.preventDefault();
    if (!selectedId) return;
    const n = Number(qty);
    if (!(n > 0)) {
      setErr('Quantity must be greater than zero.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onAddComponent(kit, selectedId, n);
      setSelectedId('');
      setQty('1');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kit-detail">
      <p className="kit-detail-title">Contents of {kit.partNumber}</p>

      {components.length === 0 ? (
        <p className="kit-empty">This kit is empty.</p>
      ) : (
        <ComponentTree
          components={components}
          byId={byId}
          seen={new Set([kit.id])}
          onRemove={isAdmin ? (index) => onRemoveComponent(kit, index) : null}
        />
      )}

      {isAdmin && (
        <form className="kit-add" onSubmit={handleAdd}>
          <select
            className="input select"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">Add a material…</option>
            {addable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.partNumber}
                {m.description ? ` — ${m.description}` : ''}
                {m.isKit ? ' [kit]' : ''}
              </option>
            ))}
          </select>
          <input
            className="input qty-input"
            type="number"
            min="0"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            aria-label="Quantity"
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={busy || !selectedId}
          >
            Add
          </button>
          {err && <span className="kit-add-err">{err}</span>}
        </form>
      )}
    </div>
  );
}

// ----- recursive tree of components -----
// `onRemove` is only passed for the top level, so only a kit's direct
// components get a remove button. Deeper materials are edited via their
// own row in the catalogue.

function ComponentTree({ components, byId, seen, onRemove }) {
  return (
    <ul className="kit-tree">
      {components.map((component, index) => {
        const material = byId.get(component.materialId);

        if (!material) {
          return (
            <li key={index} className="kit-node">
              <span className="kit-qty">{component.qty}×</span>
              <span className="dim">missing material</span>
              {onRemove && (
                <button
                  className="kit-remove"
                  onClick={() => onRemove(index)}
                  aria-label="Remove"
                >
                  ×
                </button>
              )}
            </li>
          );
        }

        const isCycle = seen.has(material.id);
        const childSeen = new Set(seen);
        childSeen.add(material.id);
        const childComponents = material.components || [];

        return (
          <li key={material.id + '-' + index} className="kit-node">
            <div className="kit-node-row">
              <span className="kit-qty">{component.qty}×</span>
              <span className="mono strong">{material.partNumber}</span>
              {material.description && (
                <span className="kit-desc">{material.description}</span>
              )}
              {material.isKit && <span className="tag tag-kit">kit</span>}
              {isCycle && (
                <span className="cycle-flag">circular — not expanded</span>
              )}
              {onRemove && (
                <button
                  className="kit-remove"
                  onClick={() => onRemove(index)}
                  aria-label="Remove"
                >
                  ×
                </button>
              )}
            </div>
            {material.isKit && !isCycle && childComponents.length > 0 && (
              <ComponentTree
                components={childComponents}
                byId={byId}
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
