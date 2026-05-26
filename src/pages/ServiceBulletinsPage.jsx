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
import { useScope } from '../lib/scope';
import { chunk } from '../lib/batch';
import { useSort } from '../lib/useSort';
import BatchInput from '../components/BatchInput';
import FilterBar from '../components/FilterBar';
import SBDetail from '../components/SBDetail';
import SortableHeader from '../components/SortableHeader';

export default function ServiceBulletinsPage() {
  const { isAdmin } = useAuth();
  const scope = useScope();

  const [sbs, setSbs] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [drawings, setDrawings] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [aircraft, setAircraft] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add form
  const [sbRef, setSbRef] = useState('');
  const [rev, setRev] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState('');

  // Live data — bulletins, their configs, plus drawings/materials/aircraft
  // for the link pickers inside each bulletin.
  useEffect(() => {
    const subs = [
      onSnapshot(
        query(collection(db, COLLECTIONS.SERVICE_BULLETIN), orderBy('sbRef')),
        (snap) => {
          setSbs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setLoading(false);
        },
        (err) => {
          setError(err.message);
          setLoading(false);
        }
      ),
      onSnapshot(collection(db, COLLECTIONS.SB_CONFIG), (snap) =>
        setConfigs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
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

  // SBs inside the current scope. Empty scope = show everything.
  const scopedSbs = useMemo(() => {
    if (scope.sbIds === null) return sbs;
    return sbs.filter((s) => scope.sbIds.has(s.id));
  }, [sbs, scope.sbIds]);

  // Quick filter — matches SB reference, rev or title.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return scopedSbs;
    return scopedSbs.filter(
      (s) =>
        s.sbRef.toLowerCase().includes(q) ||
        (s.rev || '').toLowerCase().includes(q) ||
        (s.title || '').toLowerCase().includes(q)
    );
  }, [scopedSbs, filter]);

  // Sort — counts roll up configs + drawings + materials into one number.
  const sortColumns = useMemo(
    () => ({
      sbRef: (s) => s.sbRef || '',
      rev: (s) => s.rev || '',
      title: (s) => s.title || '',
      contents: (s) =>
        configs.filter((c) => c.sbId === s.id).length +
        (Array.isArray(s.materials) ? s.materials.length : 0),
    }),
    [configs]
  );
  const { sorted, sortKey, sortDir, toggle } = useSort(
    filtered,
    sortColumns,
    'sbRef'
  );

  async function handleAdd(event) {
    event.preventDefault();
    const ref = sbRef.trim();
    if (!ref) return;
    if (sbs.some((s) => s.sbRef.toLowerCase() === ref.toLowerCase())) {
      setError(`A service bulletin "${ref}" already exists.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addDoc(collection(db, COLLECTIONS.SERVICE_BULLETIN), {
        sbRef: ref,
        rev: rev.trim(),
        title: title.trim(),
        materials: [],
        createdAt: serverTimestamp(),
      });
      setSbRef('');
      setRev('');
      setTitle('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function importSBs(rows) {
    const existing = new Set(sbs.map((s) => s.sbRef.toLowerCase()));
    const toAdd = [];
    for (const row of rows) {
      const ref = (row.sbRef || '').trim();
      if (!ref || existing.has(ref.toLowerCase())) continue;
      existing.add(ref.toLowerCase());
      toAdd.push({
        sbRef: ref,
        rev: (row.rev || '').trim(),
        title: (row.title || '').trim(),
        materials: [],
        createdAt: serverTimestamp(),
      });
    }
    for (const group of chunk(toAdd, 450)) {
      const batch = writeBatch(db);
      for (const data of group) {
        batch.set(doc(collection(db, COLLECTIONS.SERVICE_BULLETIN)), data);
      }
      await batch.commit();
    }
  }

  async function handleDelete(sb) {
    const childConfigs = configs.filter((c) => c.sbId === sb.id);
    const extra = childConfigs.length
      ? `\n\nIts ${childConfigs.length} configuration(s) will also be deleted.`
      : '';
    if (!window.confirm(`Delete service bulletin "${sb.sbRef}"?${extra}`)) {
      return;
    }
    setError(null);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, COLLECTIONS.SERVICE_BULLETIN, sb.id));
      for (const c of childConfigs) {
        batch.delete(doc(db, COLLECTIONS.SB_CONFIG, c.id));
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

  const colSpan = isAdmin ? 6 : 5;

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Entity</p>
        <h1>Service Bulletins</h1>
        <p className="lede">
          The modification instructions. Each bulletin has configurations
          (aircraft groupings), referenced drawings, required materials, and
          references to the aircraft manuals.
        </p>
      </div>

      {isAdmin && (
        <section className="panel">
          <h2 className="panel-title">Add a service bulletin</h2>
          <form className="form-row" onSubmit={handleAdd}>
            <div className="field">
              <label htmlFor="sbref">SB reference</label>
              <input
                id="sbref"
                className="input mono"
                placeholder="SB-777-25-0142"
                value={sbRef}
                onChange={(e) => setSbRef(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="field field-rev">
              <label htmlFor="sbrev">Rev</label>
              <input
                id="sbrev"
                className="input mono"
                placeholder="A"
                value={rev}
                onChange={(e) => setRev(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="field field-wide">
              <label htmlFor="sbtitle">Title</label>
              <input
                id="sbtitle"
                className="input"
                placeholder="Cabin reconfiguration — forward galley"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add bulletin'}
            </button>
          </form>
          {error && <p className="notice notice-error">{error}</p>}

          <BatchInput
            noun="bulletins"
            onImport={importSBs}
            fields={[
              { key: 'sbRef', label: 'SB reference', required: true },
              { key: 'rev', label: 'Rev' },
              { key: 'title', label: 'Title' },
            ]}
          />
        </section>
      )}

      <section className="panel">
        <div className="panel-titlebar">
          <h2 className="panel-title">Bulletins</h2>
          <span className="count">{scopedSbs.length}</span>
          <FilterBar
            value={filter}
            onChange={setFilter}
            placeholder="Filter bulletins…"
            count={filtered.length}
            total={scopedSbs.length}
          />
        </div>

        {loading ? (
          <p className="notice">Loading…</p>
        ) : sbs.length === 0 ? (
          <p className="notice">
            No service bulletins yet.
            {isAdmin
              ? ' Add one above, or bulk add a list.'
              : ' An admin can add the first one.'}
          </p>
        ) : filtered.length === 0 ? (
          <p className="notice">No bulletins match the filter.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="col-caret" />
                <SortableHeader
                  label="SB reference"
                  column="sbRef"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Rev"
                  column="rev"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Title"
                  column="title"
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
              {sorted.map((sb) => {
                const sbConfigs = configs.filter((c) => c.sbId === sb.id);
                const matCount = (sb.materials || []).length;
                const isOpen = expanded.has(sb.id);
                return (
                  <Fragment key={sb.id}>
                    <tr>
                      <td className="col-caret">
                        <button
                          className="expand-btn"
                          onClick={() => toggleExpand(sb.id)}
                          aria-label={isOpen ? 'Collapse' : 'Expand'}
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="mono strong">{sb.sbRef}</td>
                      <td className="mono">
                        {sb.rev || <span className="dim">—</span>}
                      </td>
                      <td>{sb.title || <span className="dim">—</span>}</td>
                      <td className="dim col-meta">
                        {sbConfigs.length} config
                        {sbConfigs.length === 1 ? '' : 's'} · {matCount}{' '}
                        material{matCount === 1 ? '' : 's'}
                      </td>
                      {isAdmin && (
                        <td className="col-action">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleDelete(sb)}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="detail-row">
                        <td colSpan={colSpan}>
                          <SBDetail
                            sb={sb}
                            configs={sbConfigs}
                            materials={materials}
                            aircraft={aircraft}
                            drawingById={drawingById}
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
