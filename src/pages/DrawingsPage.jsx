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
import { chunk } from '../lib/batch';
import { wouldRefCycle } from '../lib/drawings';
import BatchInput from '../components/BatchInput';
import FilterBar from '../components/FilterBar';
import MultiSelect from '../components/MultiSelect';

export default function DrawingsPage() {
  const { isAdmin } = useAuth();

  const [drawings, setDrawings] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [aircraft, setAircraft] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add form
  const [docNumber, setDocNumber] = useState('');
  const [rev, setRev] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState('');

  // Live data — drawings, plus materials and aircraft for the link pickers.
  useEffect(() => {
    const subs = [
      onSnapshot(
        query(collection(db, COLLECTIONS.DRAWING), orderBy('docNumber')),
        (snap) => {
          setDrawings(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setLoading(false);
        },
        (err) => {
          setError(err.message);
          setLoading(false);
        }
      ),
      onSnapshot(
        query(collection(db, COLLECTIONS.MATERIAL), orderBy('partNumber')),
        (snap) => setMaterials(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(
        query(collection(db, COLLECTIONS.AIRCRAFT), orderBy('registration')),
        (snap) => setAircraft(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
    ];
    return () => subs.forEach((unsub) => unsub());
  }, []);

  // Lookups used to resolve references and pasted part numbers.
  const materialById = useMemo(() => {
    const m = new Map();
    for (const x of materials) m.set(x.id, x);
    return m;
  }, [materials]);

  const materialByPN = useMemo(() => {
    const m = new Map();
    for (const x of materials) m.set(x.partNumber.toLowerCase(), x);
    return m;
  }, [materials]);

  const aircraftById = useMemo(() => {
    const m = new Map();
    for (const x of aircraft) m.set(x.id, x);
    return m;
  }, [aircraft]);

  const drawingById = useMemo(() => {
    const m = new Map();
    for (const x of drawings) m.set(x.id, x);
    return m;
  }, [drawings]);

  // Quick filter — matches document number, rev or title.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return drawings;
    return drawings.filter(
      (d) =>
        d.docNumber.toLowerCase().includes(q) ||
        (d.rev || '').toLowerCase().includes(q) ||
        (d.title || '').toLowerCase().includes(q)
    );
  }, [drawings, filter]);

  async function handleAdd(event) {
    event.preventDefault();
    const dn = docNumber.trim();
    if (!dn) return;
    if (drawings.some((d) => d.docNumber.toLowerCase() === dn.toLowerCase())) {
      setError(`A drawing with document number "${dn}" already exists.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addDoc(collection(db, COLLECTIONS.DRAWING), {
        docNumber: dn,
        rev: rev.trim(),
        title: title.trim(),
        materials: [],
        aircraftIds: [],
        refDrawingIds: [],
        createdAt: serverTimestamp(),
      });
      setDocNumber('');
      setRev('');
      setTitle('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function importDrawings(rows) {
    const existing = new Set(drawings.map((d) => d.docNumber.toLowerCase()));
    const toAdd = [];
    for (const row of rows) {
      const dn = (row.docNumber || '').trim();
      if (!dn || existing.has(dn.toLowerCase())) continue;
      existing.add(dn.toLowerCase());
      toAdd.push({
        docNumber: dn,
        rev: (row.rev || '').trim(),
        title: (row.title || '').trim(),
        materials: [],
        aircraftIds: [],
        refDrawingIds: [],
        createdAt: serverTimestamp(),
      });
    }
    for (const group of chunk(toAdd, 450)) {
      const batch = writeBatch(db);
      for (const data of group) {
        batch.set(doc(collection(db, COLLECTIONS.DRAWING)), data);
      }
      await batch.commit();
    }
  }

  async function handleDelete(drawing) {
    if (!window.confirm(`Delete drawing "${drawing.docNumber}"?`)) return;
    setError(null);
    try {
      await deleteDoc(doc(db, COLLECTIONS.DRAWING, drawing.id));
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

  const colSpan = isAdmin ? 6 : 5;

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Entity</p>
        <h1>Drawings</h1>
        <p className="lede">
          Drawing documents. Each one lists the materials it calls out, the
          aircraft it applies to, and the other drawings it references — and
          those references can nest.
        </p>
      </div>

      {isAdmin && (
        <section className="panel">
          <h2 className="panel-title">Add a drawing</h2>
          <form className="form-row" onSubmit={handleAdd}>
            <div className="field">
              <label htmlFor="dn">Document number</label>
              <input
                id="dn"
                className="input mono"
                placeholder="DRW-10245"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="field field-rev">
              <label htmlFor="rev">Rev</label>
              <input
                id="rev"
                className="input mono"
                placeholder="C"
                value={rev}
                onChange={(e) => setRev(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="field field-wide">
              <label htmlFor="title">Title</label>
              <input
                id="title"
                className="input"
                placeholder="Wing fairing assembly"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add drawing'}
            </button>
          </form>
          {error && <p className="notice notice-error">{error}</p>}

          <BatchInput
            noun="drawings"
            onImport={importDrawings}
            fields={[
              { key: 'docNumber', label: 'Document number', required: true },
              { key: 'rev', label: 'Rev' },
              { key: 'title', label: 'Title' },
            ]}
          />
        </section>
      )}

      <section className="panel">
        <div className="panel-titlebar">
          <h2 className="panel-title">Drawings</h2>
          <span className="count">{drawings.length}</span>
          <FilterBar
            value={filter}
            onChange={setFilter}
            placeholder="Filter drawings…"
            count={filtered.length}
            total={drawings.length}
          />
        </div>

        {loading ? (
          <p className="notice">Loading…</p>
        ) : drawings.length === 0 ? (
          <p className="notice">
            No drawings yet.
            {isAdmin
              ? ' Add one above, or bulk add a list.'
              : ' An admin can add the first one.'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="notice">No drawings match the filter.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="col-caret" />
                <th>Document</th>
                <th>Rev</th>
                <th>Title</th>
                <th>Contents</th>
                {isAdmin && <th className="col-action" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const matCount = (d.materials || []).length;
                const acCount = (d.aircraftIds || []).length;
                const refCount = (d.refDrawingIds || []).length;
                const isOpen = expanded.has(d.id);
                return (
                  <Fragment key={d.id}>
                    <tr>
                      <td className="col-caret">
                        <button
                          className="expand-btn"
                          onClick={() => toggleExpand(d.id)}
                          aria-label={isOpen ? 'Collapse' : 'Expand'}
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="mono strong">{d.docNumber}</td>
                      <td className="mono">
                        {d.rev || <span className="dim">—</span>}
                      </td>
                      <td>{d.title || <span className="dim">—</span>}</td>
                      <td className="dim">
                        {matCount} material{matCount === 1 ? '' : 's'} ·{' '}
                        {acCount} aircraft · {refCount} ref
                        {refCount === 1 ? '' : 's'}
                      </td>
                      {isAdmin && (
                        <td className="col-action">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleDelete(d)}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="detail-row">
                        <td colSpan={colSpan}>
                          <DrawingDetail
                            drawing={d}
                            drawings={drawings}
                            materials={materials}
                            aircraft={aircraft}
                            materialById={materialById}
                            materialByPN={materialByPN}
                            aircraftById={aircraftById}
                            drawingById={drawingById}
                            isAdmin={isAdmin}
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

// ----- expanded view: materials, referenced drawings, aircraft -----

function DrawingDetail({
  drawing,
  drawings,
  materials,
  aircraft,
  materialById,
  materialByPN,
  aircraftById,
  drawingById,
  isAdmin,
}) {
  const drawingRef = doc(db, COLLECTIONS.DRAWING, drawing.id);
  const matLinks = drawing.materials || [];
  const acLinks = drawing.aircraftIds || [];
  const refIds = drawing.refDrawingIds || [];

  // ----- materials -----
  const addableMaterials = materials.filter(
    (m) => !matLinks.some((l) => l.materialId === m.id)
  );

  async function addMaterials(ids) {
    await updateDoc(drawingRef, {
      materials: [
        ...matLinks,
        ...ids.map((id) => ({ materialId: id, qty: 1 })),
      ],
    });
  }

  async function removeMaterial(materialId) {
    await updateDoc(drawingRef, {
      materials: matLinks.filter((l) => l.materialId !== materialId),
    });
  }

  async function changeMaterialQty(materialId, value) {
    const q = Number(value);
    const current = matLinks.find((l) => l.materialId === materialId);
    if (!(q > 0) || !current || current.qty === q) return;
    await updateDoc(drawingRef, {
      materials: matLinks.map((l) =>
        l.materialId === materialId ? { ...l, qty: q } : l
      ),
    });
  }

  async function importMaterials(rows) {
    const have = new Set(matLinks.map((l) => l.materialId));
    const additions = [];
    for (const row of rows) {
      const m = materialByPN.get((row.partNumber || '').toLowerCase());
      if (!m || have.has(m.id)) continue;
      have.add(m.id);
      additions.push({ materialId: m.id, qty: Number(row.qty) || 1 });
    }
    if (additions.length) {
      await updateDoc(drawingRef, { materials: [...matLinks, ...additions] });
    }
  }

  // ----- referenced drawings -----
  // Other drawings that can be referenced: not this one, not already
  // referenced, and not one that would close a loop.
  const addableRefs = drawings.filter(
    (d) =>
      d.id !== drawing.id &&
      !refIds.includes(d.id) &&
      !wouldRefCycle(drawing.id, d.id, drawingById)
  );

  async function addRefs(ids) {
    await updateDoc(drawingRef, { refDrawingIds: [...refIds, ...ids] });
  }

  async function removeRef(id) {
    await updateDoc(drawingRef, {
      refDrawingIds: refIds.filter((x) => x !== id),
    });
  }

  // ----- aircraft -----
  const addableAircraft = aircraft.filter((a) => !acLinks.includes(a.id));

  async function addAircrafts(ids) {
    await updateDoc(drawingRef, { aircraftIds: [...acLinks, ...ids] });
  }

  async function removeAircraft(aircraftId) {
    await updateDoc(drawingRef, {
      aircraftIds: acLinks.filter((id) => id !== aircraftId),
    });
  }

  return (
    <div className="detail-panel">
      {/* ---- materials called in this drawing ---- */}
      <div className="detail-section">
        <p className="detail-section-title">
          Materials called in {drawing.docNumber}
        </p>

        {matLinks.length === 0 ? (
          <p className="kit-empty">No materials added yet.</p>
        ) : (
          <ul className="link-list">
            {matLinks.map((link) => {
              const m = materialById.get(link.materialId);
              return (
                <li key={link.materialId} className="link-row">
                  {isAdmin ? (
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="input qty-input qty-inline"
                      defaultValue={link.qty}
                      key={'q' + link.qty}
                      onBlur={(e) =>
                        changeMaterialQty(link.materialId, e.target.value)
                      }
                      aria-label="Quantity"
                    />
                  ) : (
                    <span className="kit-qty">{link.qty}×</span>
                  )}
                  <span className="mono strong">
                    {m ? m.partNumber : '(missing material)'}
                  </span>
                  {m?.description && (
                    <span className="kit-desc">{m.description}</span>
                  )}
                  {m?.isKit && <span className="tag tag-kit">kit</span>}
                  {isAdmin && (
                    <button
                      className="kit-remove"
                      onClick={() => removeMaterial(link.materialId)}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {isAdmin && (
          <>
            <MultiSelect
              placeholder="Add materials…"
              onAdd={addMaterials}
              options={addableMaterials.map((m) => ({
                id: m.id,
                label: m.partNumber,
                sublabel:
                  (m.description || '') + (m.isKit ? '  [kit]' : ''),
              }))}
            />

            <BatchInput
              noun="materials"
              onImport={importMaterials}
              fields={[
                { key: 'partNumber', label: 'Part number', required: true },
                { key: 'qty', label: 'Qty', required: true },
              ]}
              validateRow={(r) => {
                const m = materialByPN.get((r.partNumber || '').toLowerCase());
                if (!m) return 'no material with that part number';
                if (matLinks.some((l) => l.materialId === m.id))
                  return 'already on this drawing';
                if (!(Number(r.qty) > 0)) return 'quantity must be > 0';
                return null;
              }}
            />
          </>
        )}
      </div>

      {/* ---- drawings referenced by this drawing ---- */}
      <div className="detail-section">
        <p className="detail-section-title">
          Drawings referenced by {drawing.docNumber}
        </p>

        {refIds.length === 0 ? (
          <p className="kit-empty">No referenced drawings yet.</p>
        ) : (
          <DrawingRefTree
            refIds={refIds}
            drawingById={drawingById}
            seen={new Set([drawing.id])}
            onRemove={isAdmin ? removeRef : null}
          />
        )}

        {isAdmin && (
          <MultiSelect
            placeholder="Reference drawings…"
            onAdd={addRefs}
            options={addableRefs.map((d) => ({
              id: d.id,
              label: d.docNumber,
              sublabel: (d.rev ? `rev ${d.rev}  ` : '') + (d.title || ''),
            }))}
          />
        )}
      </div>

      {/* ---- aircraft this drawing applies to ---- */}
      <div className="detail-section">
        <p className="detail-section-title">Applies to aircraft</p>

        {acLinks.length === 0 ? (
          <p className="kit-empty">No aircraft added yet.</p>
        ) : (
          <ul className="link-list">
            {acLinks.map((id) => {
              const a = aircraftById.get(id);
              return (
                <li key={id} className="link-row">
                  <span className="mono strong">
                    {a ? a.registration : '(missing aircraft)'}
                  </span>
                  {a?.fleetType && (
                    <span className="kit-desc">{a.fleetType}</span>
                  )}
                  {isAdmin && (
                    <button
                      className="kit-remove"
                      onClick={() => removeAircraft(id)}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
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

// ----- recursive tree of referenced drawings -----

function DrawingRefTree({ refIds, drawingById, seen, onRemove }) {
  return (
    <ul className="kit-tree">
      {refIds.map((refId, index) => {
        const d = drawingById.get(refId);

        if (!d) {
          return (
            <li key={index} className="kit-node">
              <div className="kit-node-row">
                <span className="mono strong">(missing drawing)</span>
                {onRemove && (
                  <button
                    className="kit-remove"
                    onClick={() => onRemove(refId)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          );
        }

        const isCycle = seen.has(d.id);
        const childSeen = new Set(seen);
        childSeen.add(d.id);
        const childRefs = Array.isArray(d.refDrawingIds)
          ? d.refDrawingIds
          : [];

        return (
          <li key={index} className="kit-node">
            <div className="kit-node-row">
              <span className="mono strong">{d.docNumber}</span>
              {d.rev && <span className="kit-qty">rev {d.rev}</span>}
              {d.title && <span className="kit-desc">{d.title}</span>}
              {isCycle && (
                <span className="cycle-flag">circular — not expanded</span>
              )}
              {onRemove && (
                <button
                  className="kit-remove"
                  onClick={() => onRemove(refId)}
                  aria-label="Remove"
                >
                  ×
                </button>
              )}
            </div>
            {!isCycle && childRefs.length > 0 && (
              <DrawingRefTree
                refIds={childRefs}
                drawingById={drawingById}
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
