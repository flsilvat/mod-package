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
import BatchInput from '../components/BatchInput';

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
          Drawing documents. Each one lists the materials it calls out (with
          quantities) and the aircraft it applies to.
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
              {drawings.map((d) => {
                const matCount = (d.materials || []).length;
                const acCount = (d.aircraftIds || []).length;
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
                        {acCount} aircraft
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
                            materials={materials}
                            aircraft={aircraft}
                            materialById={materialById}
                            materialByPN={materialByPN}
                            aircraftById={aircraftById}
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

// ----- expanded view for one drawing: materials + aircraft -----

function DrawingDetail({
  drawing,
  materials,
  aircraft,
  materialById,
  materialByPN,
  aircraftById,
  isAdmin,
}) {
  const drawingRef = doc(db, COLLECTIONS.DRAWING, drawing.id);
  const matLinks = drawing.materials || [];
  const acLinks = drawing.aircraftIds || [];

  // ----- materials -----
  const [matPick, setMatPick] = useState('');
  const [matQty, setMatQty] = useState('1');
  const [err, setErr] = useState(null);

  const addableMaterials = materials.filter(
    (m) => !matLinks.some((l) => l.materialId === m.id)
  );

  async function addMaterial(event) {
    event.preventDefault();
    if (!matPick) return;
    const q = Number(matQty);
    if (!(q > 0)) {
      setErr('Quantity must be greater than zero.');
      return;
    }
    setErr(null);
    try {
      await updateDoc(drawingRef, {
        materials: [...matLinks, { materialId: matPick, qty: q }],
      });
      setMatPick('');
      setMatQty('1');
    } catch (e) {
      setErr(e.message);
    }
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

  // ----- aircraft -----
  const [acPick, setAcPick] = useState('');

  const addableAircraft = aircraft.filter((a) => !acLinks.includes(a.id));

  async function addAircraft(event) {
    event.preventDefault();
    if (!acPick) return;
    await updateDoc(drawingRef, { aircraftIds: [...acLinks, acPick] });
    setAcPick('');
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
            <form className="link-add" onSubmit={addMaterial}>
              <select
                className="input select"
                value={matPick}
                onChange={(e) => setMatPick(e.target.value)}
              >
                <option value="">Add a material…</option>
                {addableMaterials.map((m) => (
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
                value={matQty}
                onChange={(e) => setMatQty(e.target.value)}
                aria-label="Quantity"
              />
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!matPick}
              >
                Add
              </button>
              {err && <span className="kit-add-err">{err}</span>}
            </form>

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
          <form className="link-add" onSubmit={addAircraft}>
            <select
              className="input select"
              value={acPick}
              onChange={(e) => setAcPick(e.target.value)}
            >
              <option value="">Add an aircraft…</option>
              {addableAircraft.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.registration}
                  {a.fleetType ? ` — ${a.fleetType}` : ''}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!acPick}
            >
              Add
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
