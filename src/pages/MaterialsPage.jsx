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
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from '../lib/collections';
import { useAuth } from '../lib/auth';
import { wouldCreateCycle } from '../lib/materials';
import { chunk } from '../lib/batch';
import BatchInput from '../components/BatchInput';
import FilterBar from '../components/FilterBar';

export default function MaterialsPage() {
  const { isAdmin } = useAuth();

  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  // Add form
  const [partNumber, setPartNumber] = useState('');
  const [description, setDescription] = useState('');
  const [isKit, setIsKit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.MATERIAL),
      orderBy('partNumber')
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setMaterials(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, []);

  // id -> material, for walking kit trees without extra database reads.
  const byId = useMemo(() => {
    const m = new Map();
    for (const x of materials) m.set(x.id, x);
    return m;
  }, [materials]);

  // Quick filter — matches part number or description.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter(
      (m) =>
        m.partNumber.toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q)
    );
  }, [materials, filter]);

  async function handleAdd(event) {
    event.preventDefault();
    const pn = partNumber.trim();
    if (!pn) return;
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

  // Bulk add creates plain parts (isKit false). Kits are composed one at a
  // time, since their contents need picking. Commits in chunks of 450.
  async function importMaterials(rows) {
    const existing = new Set(materials.map((m) => m.partNumber.toLowerCase()));
    const toAdd = [];
    for (const row of rows) {
      const pn = (row.partNumber || '').trim();
      if (!pn || existing.has(pn.toLowerCase())) continue;
      existing.add(pn.toLowerCase());
      toAdd.push({
        partNumber: pn,
        description: (row.description || '').trim(),
        isKit: false,
        components: [],
        createdAt: serverTimestamp(),
      });
    }
    for (const group of chunk(toAdd, 450)) {
      const batch = writeBatch(db);
      for (const data of group) {
        batch.set(doc(collection(db, COLLECTIONS.MATERIAL)), data);
      }
      await batch.commit();
    }
  }

  async function handleDelete(material) {
    const uses = materials.filter(
      (x) =>
        x.isKit &&
        Array.isArray(x.components) &&
        x.components.some((c) => c.materialId === material.id)
    ).length;
    const warn =
      uses > 0
        ? `\n\nWarning: ${material.partNumber} is a component of ${uses} kit(s); they will show it as missing.`
        : '';
    if (!window.confirm(`Delete material ${material.partNumber}?${warn}`)) return;
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
    const components = Array.isArray(kit.components) ? kit.components : [];
    await updateDoc(doc(db, COLLECTIONS.MATERIAL, kit.id), {
      components: [...components, { materialId, qty }],
    });
  }

  async function removeComponent(kit, index) {
    const components = Array.isArray(kit.components) ? kit.components : [];
    await updateDoc(doc(db, COLLECTIONS.MATERIAL, kit.id), {
      components: components.filter((_, i) => i !== index),
    });
  }

  async function changeComponentQty(kit, index, value) {
    const n = Number(value);
    const components = Array.isArray(kit.components) ? kit.components : [];
    if (!(n > 0) || !components[index] || components[index].qty === n) return;
    await updateDoc(doc(db, COLLECTIONS.MATERIAL, kit.id), {
      components: components.map((c, i) => (i === index ? { ...c, qty: n } : c)),
    });
  }

  const colSpan = isAdmin ? 6 : 5;

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Entity</p>
        <h1>Materials</h1>
        <p className="lede">
          Parts and kits. A kit contains other materials — and a kit may
          contain other kits, nested as deep as needed.
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
                placeholder="PN-10245"
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
                placeholder="Bracket, lower fairing"
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
              This material is a kit
            </label>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add material'}
            </button>
          </form>
          {error && <p className="notice notice-error">{error}</p>}

          <BatchInput
            noun="materials"
            onImport={importMaterials}
            fields={[
              { key: 'partNumber', label: 'Part number', required: true },
              { key: 'description', label: 'Description' },
            ]}
            validateRow={(r) =>
              materials.some(
                (m) =>
                  m.partNumber.toLowerCase() ===
                  (r.partNumber || '').trim().toLowerCase()
              )
                ? 'already exists'
                : null
            }
          />
        </section>
      )}

      <section className="panel">
        <div className="panel-titlebar">
          <h2 className="panel-title">Catalogue</h2>
          <span className="count">{materials.length}</span>
          <FilterBar
            value={filter}
            onChange={setFilter}
            placeholder="Filter materials…"
            count={filtered.length}
            total={materials.length}
          />
        </div>

        {loading ? (
          <p className="notice">Loading…</p>
        ) : materials.length === 0 ? (
          <p className="notice">
            No materials yet.
            {isAdmin
              ? ' Add one above, or bulk add a list.'
              : ' An admin can add the first one.'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="notice">No materials match the filter.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="col-caret" />
                <th>Part number</th>
                <th>Description</th>
                <th>Type</th>
                <th>Contents</th>
                {isAdmin && <th className="col-action" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const isOpen = expanded.has(m.id);
                const compCount = Array.isArray(m.components)
                  ? m.components.length
                  : 0;
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
                          <span className="tag tag-kit">kit</span>
                        ) : (
                          <span className="tag tag-part">part</span>
                        )}
                      </td>
                      <td className="dim">
                        {m.isKit
                          ? `${compCount} component${compCount === 1 ? '' : 's'}`
                          : '—'}
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
                            materials={materials}
                            byId={byId}
                            isAdmin={isAdmin}
                            onAddComponent={addComponent}
                            onRemoveComponent={removeComponent}
                            onQtyChange={changeComponentQty}
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

// ----- expanded view for one kit: contents tree + component editor -----

function KitDetail({
  kit,
  materials,
  byId,
  isAdmin,
  onAddComponent,
  onRemoveComponent,
  onQtyChange,
}) {
  const [pick, setPick] = useState('');
  const [qty, setQty] = useState('1');
  const [err, setErr] = useState(null);
  const components = Array.isArray(kit.components) ? kit.components : [];

  // Materials that can be added: not already a component, and would not
  // create a loop (which also rules out the kit itself).
  const addable = materials.filter(
    (m) =>
      !components.some((c) => c.materialId === m.id) &&
      !wouldCreateCycle(kit.id, m.id, byId)
  );

  async function handleAdd(event) {
    event.preventDefault();
    if (!pick) return;
    const n = Number(qty);
    if (!(n > 0)) {
      setErr('Quantity must be greater than zero.');
      return;
    }
    setErr(null);
    try {
      await onAddComponent(kit, pick, n);
      setPick('');
      setQty('1');
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div className="detail-panel">
      <div className="detail-section">
        <p className="detail-section-title">Contents of {kit.partNumber}</p>

        {components.length === 0 ? (
          <p className="kit-empty">No components yet.</p>
        ) : (
          <ComponentTree
            components={components}
            byId={byId}
            seen={new Set([kit.id])}
            onRemove={isAdmin ? (index) => onRemoveComponent(kit, index) : null}
            onQtyChange={
              isAdmin ? (index, value) => onQtyChange(kit, index, value) : null
            }
          />
        )}

        {isAdmin && (
          <form className="link-add" onSubmit={handleAdd}>
            <select
              className="input select"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Add a component…</option>
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
              disabled={!pick}
            >
              Add
            </button>
            {err && <span className="kit-add-err">{err}</span>}
          </form>
        )}
      </div>
    </div>
  );
}

// ----- recursive kit tree. Editable quantities only at the top level -----

function ComponentTree({ components, byId, seen, onRemove, onQtyChange }) {
  return (
    <ul className="kit-tree">
      {components.map((component, index) => {
        const material = byId.get(component.materialId);

        if (!material) {
          return (
            <li key={index} className="kit-node">
              <div className="kit-node-row">
                <span className="kit-qty">{component.qty}×</span>
                <span className="mono strong">(missing material)</span>
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
            </li>
          );
        }

        const isCycle = seen.has(material.id);
        const childSeen = new Set(seen);
        childSeen.add(material.id);
        const childComponents = Array.isArray(material.components)
          ? material.components
          : [];

        return (
          <li key={index} className="kit-node">
            <div className="kit-node-row">
              {onQtyChange ? (
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="input qty-input qty-inline"
                  defaultValue={component.qty}
                  key={'q' + component.qty}
                  onBlur={(e) => onQtyChange(index, e.target.value)}
                  aria-label="Quantity"
                />
              ) : (
                <span className="kit-qty">{component.qty}×</span>
              )}
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
                onQtyChange={null}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
