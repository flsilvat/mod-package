import { useState, useEffect, useMemo, Fragment } from 'react';
import {
  collection,
  addDoc,
  deleteDoc,
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
import { useScope } from '../lib/scope';
import { chunk } from '../lib/batch';
import { useSort } from '../lib/useSort';
import BatchInput from '../components/BatchInput';
import FilterBar from '../components/FilterBar';
import HTLDetail from '../components/HTLDetail';
import SortableHeader from '../components/SortableHeader';

export default function HTLsPage() {
  const { isAdmin } = useAuth();
  const scope = useScope();

  const [htls, setHtls] = useState([]);
  const [gtls, setGtls] = useState([]);
  const [operations, setOperations] = useState([]);
  const [aircraft, setAircraft] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [htlRef, setHtlRef] = useState('');
  const [saving, setSaving] = useState(false);

  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState('');

  // Live data — HTLs, plus GTLs / operations / aircraft for the tree and
  // the link pickers inside each HTL.
  useEffect(() => {
    const subs = [
      onSnapshot(
        query(collection(db, COLLECTIONS.HTL), orderBy('htlRef')),
        (snap) => {
          setHtls(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setLoading(false);
        },
        (err) => {
          setError(err.message);
          setLoading(false);
        }
      ),
      onSnapshot(
        query(collection(db, COLLECTIONS.GTL), orderBy('gtlRef')),
        (snap) => setGtls(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(collection(db, COLLECTIONS.OPERATION), (snap) =>
        setOperations(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(
        query(collection(db, COLLECTIONS.AIRCRAFT), orderBy('registration')),
        (snap) => setAircraft(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
    ];
    return () => subs.forEach((unsub) => unsub());
  }, []);

  const htlById = useMemo(() => {
    const m = new Map();
    for (const x of htls) m.set(x.id, x);
    return m;
  }, [htls]);

  const gtlById = useMemo(() => {
    const m = new Map();
    for (const x of gtls) m.set(x.id, x);
    return m;
  }, [gtls]);

  const aircraftById = useMemo(() => {
    const m = new Map();
    for (const x of aircraft) m.set(x.id, x);
    return m;
  }, [aircraft]);

  const opCountByGtl = useMemo(() => {
    const m = new Map();
    for (const o of operations) m.set(o.gtlId, (m.get(o.gtlId) || 0) + 1);
    return m;
  }, [operations]);

  // HTLs inside the current scope. Empty scope = show everything.
  const scopedHtls = useMemo(() => {
    if (scope.htlIds === null) return htls;
    return htls.filter((h) => scope.htlIds.has(h.id));
  }, [htls, scope.htlIds]);

  // Quick filter — matches the HTL reference.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return scopedHtls;
    return scopedHtls.filter((h) => h.htlRef.toLowerCase().includes(q));
  }, [scopedHtls, filter]);

  // Sort: contents = children + aircraft count.
  const sortColumns = useMemo(
    () => ({
      htlRef: (h) => h.htlRef || '',
      contents: (h) =>
        (Array.isArray(h.children) ? h.children.length : 0) +
        (Array.isArray(h.aircraftIds) ? h.aircraftIds.length : 0),
    }),
    []
  );
  const { sorted, sortKey, sortDir, toggle } = useSort(
    filtered,
    sortColumns,
    'htlRef'
  );

  async function handleAdd(event) {
    event.preventDefault();
    const ref = htlRef.trim();
    if (!ref) return;
    if (htls.some((h) => h.htlRef.toLowerCase() === ref.toLowerCase())) {
      setError(`An HTL "${ref}" already exists.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addDoc(collection(db, COLLECTIONS.HTL), {
        htlRef: ref,
        children: [],
        aircraftIds: [],
        createdAt: serverTimestamp(),
      });
      setHtlRef('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function importHTLs(rows) {
    const existing = new Set(htls.map((h) => h.htlRef.toLowerCase()));
    const toAdd = [];
    for (const row of rows) {
      const ref = (row.htlRef || '').trim();
      if (!ref || existing.has(ref.toLowerCase())) continue;
      existing.add(ref.toLowerCase());
      toAdd.push({
        htlRef: ref,
        children: [],
        aircraftIds: [],
        createdAt: serverTimestamp(),
      });
    }
    for (const group of chunk(toAdd, 450)) {
      const batch = writeBatch(db);
      for (const data of group) {
        batch.set(doc(collection(db, COLLECTIONS.HTL)), data);
      }
      await batch.commit();
    }
  }

  async function handleDelete(htl) {
    const referencedBy = htls.filter(
      (h) =>
        Array.isArray(h.children) &&
        h.children.some((c) => c.type === 'htl' && c.id === htl.id)
    );
    const extra = referencedBy.length
      ? `\n\nIt is used inside ${referencedBy.length} other HTL(s); it will show as missing there.`
      : '';
    if (!window.confirm(`Delete HTL "${htl.htlRef}"?${extra}`)) return;
    setError(null);
    try {
      await deleteDoc(doc(db, COLLECTIONS.HTL, htl.id));
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
        <h1>HTLs</h1>
        <p className="lede">
          Hierarchical Task Lists — a reusable tree that groups GTLs and other
          HTLs. A Technical Order part points at one HTL.
        </p>
      </div>

      {isAdmin && (
        <section className="panel">
          <h2 className="panel-title">Add an HTL</h2>
          <form className="form-row" onSubmit={handleAdd}>
            <div className="field field-wide">
              <label htmlFor="htlref">HTL reference</label>
              <input
                id="htlref"
                className="input mono"
                placeholder="HTL-0042"
                value={htlRef}
                onChange={(e) => setHtlRef(e.target.value)}
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add HTL'}
            </button>
          </form>
          {error && <p className="notice notice-error">{error}</p>}

          <BatchInput
            noun="HTLs"
            onImport={importHTLs}
            fields={[{ key: 'htlRef', label: 'HTL reference', required: true }]}
          />
        </section>
      )}

      <section className="panel">
        <div className="panel-titlebar">
          <h2 className="panel-title">HTLs</h2>
          <span className="count">{scopedHtls.length}</span>
          <FilterBar
            value={filter}
            onChange={setFilter}
            placeholder="Filter HTLs…"
            count={filtered.length}
            total={scopedHtls.length}
          />
        </div>

        {loading ? (
          <p className="notice">Loading…</p>
        ) : htls.length === 0 ? (
          <p className="notice">
            No HTLs yet.
            {isAdmin
              ? ' Add one above, or bulk add a list.'
              : ' An admin can add the first one.'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="notice">No HTLs match the filter.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="col-caret" />
                <SortableHeader
                  label="HTL reference"
                  column="htlRef"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Contents"
                  column="contents"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                />
                {isAdmin && <th className="col-action" />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => {
                const ch = Array.isArray(h.children) ? h.children : [];
                const gtlCount = ch.filter((c) => c.type === 'gtl').length;
                const htlCount = ch.filter((c) => c.type === 'htl').length;
                const acCount = (h.aircraftIds || []).length;
                const isOpen = expanded.has(h.id);
                return (
                  <Fragment key={h.id}>
                    <tr>
                      <td className="col-caret">
                        <button
                          className="expand-btn"
                          onClick={() => toggleExpand(h.id)}
                          aria-label={isOpen ? 'Collapse' : 'Expand'}
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="mono strong">{h.htlRef}</td>
                      <td className="dim">
                        {gtlCount} GTL{gtlCount === 1 ? '' : 's'} · {htlCount}{' '}
                        HTL{htlCount === 1 ? '' : 's'} · {acCount} aircraft
                      </td>
                      {isAdmin && (
                        <td className="col-action">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleDelete(h)}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="detail-row">
                        <td colSpan={colSpan}>
                          <HTLDetail
                            htl={h}
                            htls={htls}
                            gtls={gtls}
                            aircraft={aircraft}
                            htlById={htlById}
                            gtlById={gtlById}
                            aircraftById={aircraftById}
                            opCountByGtl={opCountByGtl}
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
