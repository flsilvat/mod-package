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
import { chunk } from '../lib/batch';
import { useSort } from '../lib/useSort';
import BatchInput from '../components/BatchInput';
import FilterBar from '../components/FilterBar';
import TODetail from '../components/TODetail';
import SortableHeader from '../components/SortableHeader';

export default function TechnicalOrdersPage() {
  const { isAdmin } = useAuth();

  const [tos, setTos] = useState([]);
  const [parts, setParts] = useState([]);
  const [sbs, setSbs] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [htls, setHtls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [toNumber, setToNumber] = useState('');
  const [sbId, setSbId] = useState('');
  const [saving, setSaving] = useState(false);

  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState('');

  // Live data — Technical Orders and their parts, plus the bulletins,
  // configs and HTLs the parts are built from.
  useEffect(() => {
    const subs = [
      onSnapshot(
        query(collection(db, COLLECTIONS.TECHNICAL_ORDER), orderBy('toNumber')),
        (snap) => {
          setTos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setLoading(false);
        },
        (err) => {
          setError(err.message);
          setLoading(false);
        }
      ),
      onSnapshot(collection(db, COLLECTIONS.TO_PART), (snap) =>
        setParts(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(
        query(collection(db, COLLECTIONS.SERVICE_BULLETIN), orderBy('sbRef')),
        (snap) => setSbs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(collection(db, COLLECTIONS.SB_CONFIG), (snap) =>
        setConfigs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(
        query(collection(db, COLLECTIONS.HTL), orderBy('htlRef')),
        (snap) => setHtls(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
    ];
    return () => subs.forEach((unsub) => unsub());
  }, []);

  const sbById = useMemo(() => {
    const m = new Map();
    for (const x of sbs) m.set(x.id, x);
    return m;
  }, [sbs]);

  const sbByRef = useMemo(() => {
    const m = new Map();
    for (const x of sbs) m.set(x.sbRef.toLowerCase(), x);
    return m;
  }, [sbs]);

  const configById = useMemo(() => {
    const m = new Map();
    for (const x of configs) m.set(x.id, x);
    return m;
  }, [configs]);

  const htlById = useMemo(() => {
    const m = new Map();
    for (const x of htls) m.set(x.id, x);
    return m;
  }, [htls]);

  // Quick filter — matches the TO number or the bulletin reference.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tos;
    return tos.filter((t) => {
      const sb = sbById.get(t.sbId);
      return (
        t.toNumber.toLowerCase().includes(q) ||
        (sb && sb.sbRef.toLowerCase().includes(q)) ||
        (sb && (sb.rev || '').toLowerCase().includes(q))
      );
    });
  }, [tos, filter, sbById]);

  const sortColumns = useMemo(
    () => ({
      toNumber: (t) => t.toNumber || '',
      builtFrom: (t) => sbById.get(t.sbId)?.sbRef || '',
      parts: (t) => parts.filter((p) => p.technicalOrderId === t.id).length,
    }),
    [sbById, parts]
  );
  const { sorted, sortKey, sortDir, toggle } = useSort(
    filtered,
    sortColumns,
    'toNumber'
  );

  async function handleAdd(event) {
    event.preventDefault();
    const num = toNumber.trim();
    if (!num || !sbId) return;
    if (tos.some((t) => t.toNumber.toLowerCase() === num.toLowerCase())) {
      setError(`A Technical Order "${num}" already exists.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addDoc(collection(db, COLLECTIONS.TECHNICAL_ORDER), {
        toNumber: num,
        sbId,
        createdAt: serverTimestamp(),
      });
      setToNumber('');
      setSbId('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function importTOs(rows) {
    const existing = new Set(tos.map((t) => t.toNumber.toLowerCase()));
    const toAdd = [];
    for (const row of rows) {
      const num = (row.toNumber || '').trim();
      const sb = sbByRef.get((row.sbRef || '').toLowerCase());
      if (!num || !sb || existing.has(num.toLowerCase())) continue;
      existing.add(num.toLowerCase());
      toAdd.push({ toNumber: num, sbId: sb.id, createdAt: serverTimestamp() });
    }
    for (const group of chunk(toAdd, 450)) {
      const batch = writeBatch(db);
      for (const data of group) {
        batch.set(doc(collection(db, COLLECTIONS.TECHNICAL_ORDER)), data);
      }
      await batch.commit();
    }
  }

  async function handleDelete(to) {
    const childParts = parts.filter((p) => p.technicalOrderId === to.id);
    const extra = childParts.length
      ? `\n\nIts ${childParts.length} part(s) will also be deleted.`
      : '';
    if (!window.confirm(`Delete Technical Order "${to.toNumber}"?${extra}`)) {
      return;
    }
    setError(null);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, COLLECTIONS.TECHNICAL_ORDER, to.id));
      for (const p of childParts) {
        batch.delete(doc(db, COLLECTIONS.TO_PART, p.id));
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

  const colSpan = isAdmin ? 5 : 4;

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Entity</p>
        <h1>Technical Orders</h1>
        <p className="lede">
          The deliverable. A Technical Order is built from one Service Bulletin
          and split into parts — each part covers one of the bulletin's
          configurations and points to one HTL.
        </p>
      </div>

      {isAdmin && (
        <section className="panel">
          <h2 className="panel-title">Add a Technical Order</h2>
          {sbs.length === 0 ? (
            <p className="notice">
              Create a Service Bulletin first — a Technical Order is built from
              one.
            </p>
          ) : (
            <>
              <form className="form-row" onSubmit={handleAdd}>
                <div className="field">
                  <label htmlFor="tonum">TO number</label>
                  <input
                    id="tonum"
                    className="input mono"
                    placeholder="TO-25-0142"
                    value={toNumber}
                    onChange={(e) => setToNumber(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="field field-wide">
                  <label htmlFor="tosb">Built from bulletin</label>
                  <select
                    id="tosb"
                    className="input select"
                    value={sbId}
                    onChange={(e) => setSbId(e.target.value)}
                  >
                    <option value="">Choose a Service Bulletin…</option>
                    {sbs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.sbRef}
                        {s.rev ? ` rev ${s.rev}` : ''}
                        {s.title ? ` — ${s.title}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || !toNumber.trim() || !sbId}
                >
                  {saving ? 'Saving…' : 'Add Technical Order'}
                </button>
              </form>
              {error && <p className="notice notice-error">{error}</p>}

              <BatchInput
                noun="Technical Orders"
                onImport={importTOs}
                fields={[
                  { key: 'toNumber', label: 'TO number', required: true },
                  { key: 'sbRef', label: 'SB reference', required: true },
                ]}
                validateRow={(r) => {
                  const num = (r.toNumber || '').trim();
                  if (
                    tos.some(
                      (t) => t.toNumber.toLowerCase() === num.toLowerCase()
                    )
                  )
                    return 'already exists';
                  if (!sbByRef.get((r.sbRef || '').toLowerCase()))
                    return 'no bulletin with that SB reference';
                  return null;
                }}
              />
            </>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-titlebar">
          <h2 className="panel-title">Technical Orders</h2>
          <span className="count">{tos.length}</span>
          <FilterBar
            value={filter}
            onChange={setFilter}
            placeholder="Filter Technical Orders…"
            count={filtered.length}
            total={tos.length}
          />
        </div>

        {loading ? (
          <p className="notice">Loading…</p>
        ) : tos.length === 0 ? (
          <p className="notice">
            No Technical Orders yet.
            {isAdmin
              ? ' Add one above, or bulk add a list.'
              : ' An admin can add the first one.'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="notice">No Technical Orders match the filter.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="col-caret" />
                <SortableHeader
                  label="TO number"
                  column="toNumber"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Built from"
                  column="builtFrom"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Parts"
                  column="parts"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                />
                {isAdmin && <th className="col-action" />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const sb = sbById.get(t.sbId);
                const toParts = parts.filter(
                  (p) => p.technicalOrderId === t.id
                );
                const isOpen = expanded.has(t.id);
                return (
                  <Fragment key={t.id}>
                    <tr>
                      <td className="col-caret">
                        <button
                          className="expand-btn"
                          onClick={() => toggleExpand(t.id)}
                          aria-label={isOpen ? 'Collapse' : 'Expand'}
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="mono strong">{t.toNumber}</td>
                      <td className="mono">
                        {sb ? (
                          <>
                            {sb.sbRef}
                            {sb.rev && (
                              <span className="dim"> rev {sb.rev}</span>
                            )}
                            {sb.title && (
                              <span className="builtfrom-title">
                                {sb.title}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="dim">(missing bulletin)</span>
                        )}
                      </td>
                      <td className="dim">
                        {toParts.length} part{toParts.length === 1 ? '' : 's'}
                      </td>
                      {isAdmin && (
                        <td className="col-action">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleDelete(t)}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="detail-row">
                        <td colSpan={colSpan}>
                          <TODetail
                            to={t}
                            sb={sb}
                            parts={toParts}
                            configs={configs.filter(
                              (c) => c.sbId === t.sbId
                            )}
                            htls={htls}
                            configById={configById}
                            htlById={htlById}
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
