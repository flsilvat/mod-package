import { useState, useEffect, useMemo, Fragment } from 'react';
import {
  collection,
  addDoc,
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
import FilterBar from '../components/FilterBar';
import GTLDetail from '../components/GTLDetail';

export default function GTLsPage() {
  const { isAdmin } = useAuth();

  const [gtls, setGtls] = useState([]);
  const [operations, setOperations] = useState([]);
  const [drawings, setDrawings] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [aircraft, setAircraft] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [gtlRef, setGtlRef] = useState('');
  const [saving, setSaving] = useState(false);

  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState('');

  // Live data — GTLs, their operations, plus drawings/materials/aircraft
  // for the link pickers inside each operation.
  useEffect(() => {
    const subs = [
      onSnapshot(
        query(collection(db, COLLECTIONS.GTL), orderBy('gtlRef')),
        (snap) => {
          setGtls(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setLoading(false);
        },
        (err) => {
          setError(err.message);
          setLoading(false);
        }
      ),
      onSnapshot(collection(db, COLLECTIONS.OPERATION), (snap) =>
        setOperations(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(
        query(collection(db, COLLECTIONS.DRAWING), orderBy('docNumber')),
        (snap) => setDrawings(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
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

  const drawingById = useMemo(() => {
    const m = new Map();
    for (const x of drawings) m.set(x.id, x);
    return m;
  }, [drawings]);

  const materialById = useMemo(() => {
    const m = new Map();
    for (const x of materials) m.set(x.id, x);
    return m;
  }, [materials]);

  const aircraftById = useMemo(() => {
    const m = new Map();
    for (const x of aircraft) m.set(x.id, x);
    return m;
  }, [aircraft]);

  // Quick filter — matches the GTL reference.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return gtls;
    return gtls.filter((g) => g.gtlRef.toLowerCase().includes(q));
  }, [gtls, filter]);

  async function handleAdd(event) {
    event.preventDefault();
    const ref = gtlRef.trim();
    if (!ref) return;
    if (gtls.some((g) => g.gtlRef.toLowerCase() === ref.toLowerCase())) {
      setError(`A GTL "${ref}" already exists.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addDoc(collection(db, COLLECTIONS.GTL), {
        gtlRef: ref,
        aircraftIds: [],
        createdAt: serverTimestamp(),
      });
      setGtlRef('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function importGTLs(rows) {
    const existing = new Set(gtls.map((g) => g.gtlRef.toLowerCase()));
    const toAdd = [];
    for (const row of rows) {
      const ref = (row.gtlRef || '').trim();
      if (!ref || existing.has(ref.toLowerCase())) continue;
      existing.add(ref.toLowerCase());
      toAdd.push({
        gtlRef: ref,
        aircraftIds: [],
        createdAt: serverTimestamp(),
      });
    }
    for (const group of chunk(toAdd, 450)) {
      const batch = writeBatch(db);
      for (const data of group) {
        batch.set(doc(collection(db, COLLECTIONS.GTL)), data);
      }
      await batch.commit();
    }
  }

  async function handleDelete(gtl) {
    const childOps = operations.filter((o) => o.gtlId === gtl.id);
    const extra = childOps.length
      ? `\n\nIts ${childOps.length} operation(s) will also be deleted.`
      : '';
    if (!window.confirm(`Delete GTL "${gtl.gtlRef}"?${extra}`)) return;
    setError(null);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, COLLECTIONS.GTL, gtl.id));
      for (const o of childOps) {
        batch.delete(doc(db, COLLECTIONS.OPERATION, o.id));
      }
      await batch.commit();
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

  const colSpan = isAdmin ? 4 : 3;

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Entity</p>
        <h1>GTLs</h1>
        <p className="lede">
          General Task Lists — a reusable, ordered set of operations (the SAP
          steps). A GTL can be slotted into any number of HTLs.
        </p>
      </div>

      {isAdmin && (
        <section className="panel">
          <h2 className="panel-title">Add a GTL</h2>
          <form className="form-row" onSubmit={handleAdd}>
            <div className="field field-wide">
              <label htmlFor="gtlref">GTL reference</label>
              <input
                id="gtlref"
                className="input mono"
                placeholder="GTL-0042"
                value={gtlRef}
                onChange={(e) => setGtlRef(e.target.value)}
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add GTL'}
            </button>
          </form>
          {error && <p className="notice notice-error">{error}</p>}

          <BatchInput
            noun="GTLs"
            onImport={importGTLs}
            fields={[{ key: 'gtlRef', label: 'GTL reference', required: true }]}
          />
        </section>
      )}

      <section className="panel">
        <div className="panel-titlebar">
          <h2 className="panel-title">GTLs</h2>
          <span className="count">{gtls.length}</span>
          <FilterBar
            value={filter}
            onChange={setFilter}
            placeholder="Filter GTLs…"
            count={filtered.length}
            total={gtls.length}
          />
        </div>

        {loading ? (
          <p className="notice">Loading…</p>
        ) : gtls.length === 0 ? (
          <p className="notice">
            No GTLs yet.
            {isAdmin
              ? ' Add one above, or bulk add a list.'
              : ' An admin can add the first one.'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="notice">No GTLs match the filter.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="col-caret" />
                <th>GTL reference</th>
                <th>Contents</th>
                {isAdmin && <th className="col-action" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => {
                const ops = operations.filter((o) => o.gtlId === g.id);
                const acCount = (g.aircraftIds || []).length;
                const isOpen = expanded.has(g.id);
                return (
                  <Fragment key={g.id}>
                    <tr>
                      <td className="col-caret">
                        <button
                          className="expand-btn"
                          onClick={() => toggleExpand(g.id)}
                          aria-label={isOpen ? 'Collapse' : 'Expand'}
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="mono strong">{g.gtlRef}</td>
                      <td className="dim">
                        {ops.length} operation{ops.length === 1 ? '' : 's'} ·{' '}
                        {acCount} aircraft
                      </td>
                      {isAdmin && (
                        <td className="col-action">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleDelete(g)}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="detail-row">
                        <td colSpan={colSpan}>
                          <GTLDetail
                            gtl={g}
                            operations={ops}
                            drawings={drawings}
                            materials={materials}
                            aircraft={aircraft}
                            drawingById={drawingById}
                            materialById={materialById}
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
