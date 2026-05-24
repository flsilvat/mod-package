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
import { useScope } from '../lib/scope';
import { chunk } from '../lib/batch';
import { wouldRefCycle } from '../lib/drawings';
import BatchInput from '../components/BatchInput';
import FilterBar from '../components/FilterBar';
import MultiSelect from '../components/MultiSelect';
import KitContents from '../components/KitContents';
import AlternatesChip from '../components/AlternatesChip';
import SortableHeader from '../components/SortableHeader';
import { useSort } from '../lib/useSort';

export default function DrawingsPage() {
  const { isAdmin } = useAuth();
  const scope = useScope();

  const [drawings, setDrawings] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [sbs, setSbs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add form
  const [docNumber, setDocNumber] = useState('');
  const [rev, setRev] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState('');

  // Live data — drawings, plus materials and SB configs for the link pickers
  // (and the bulletins, to label each config with its SB reference).
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
      onSnapshot(collection(db, COLLECTIONS.SB_CONFIG), (snap) =>
        setConfigs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(
        query(collection(db, COLLECTIONS.SERVICE_BULLETIN), orderBy('sbRef')),
        (snap) => setSbs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
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

  const configById = useMemo(() => {
    const m = new Map();
    for (const x of configs) m.set(x.id, x);
    return m;
  }, [configs]);

  const sbById = useMemo(() => {
    const m = new Map();
    for (const x of sbs) m.set(x.id, x);
    return m;
  }, [sbs]);

  const drawingById = useMemo(() => {
    const m = new Map();
    for (const x of drawings) m.set(x.id, x);
    return m;
  }, [drawings]);

  // Drawings inside the current scope. Empty scope = show everything.
  const scopedDrawings = useMemo(() => {
    if (scope.drawingIds === null) return drawings;
    return drawings.filter((d) => scope.drawingIds.has(d.id));
  }, [drawings, scope.drawingIds]);

  // Quick filter — matches document number, rev or title.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return scopedDrawings;
    return scopedDrawings.filter(
      (d) =>
        d.docNumber.toLowerCase().includes(q) ||
        (d.rev || '').toLowerCase().includes(q) ||
        (d.title || '').toLowerCase().includes(q)
    );
  }, [scopedDrawings, filter]);

  const sortColumns = useMemo(
    () => ({
      docNumber: (d) => d.docNumber || '',
      rev: (d) => d.rev || '',
      title: (d) => d.title || '',
      contents: (d) =>
        (Array.isArray(d.materials) ? d.materials.length : 0) +
        (Array.isArray(d.sbConfigIds) ? d.sbConfigIds.length : 0) +
        (Array.isArray(d.refDrawingIds) ? d.refDrawingIds.length : 0),
    }),
    []
  );
  const { sorted, sortKey, sortDir, toggle } = useSort(
    filtered,
    sortColumns,
    'docNumber'
  );

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
        sbConfigIds: [],
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
        sbConfigIds: [],
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
          Drawing documents. Each one lists the materials it calls out, the SB
          configurations it applies to, and the other drawings it references —
          and those references can nest.
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
          <span className="count">{scopedDrawings.length}</span>
          <FilterBar
            value={filter}
            onChange={setFilter}
            placeholder="Filter drawings…"
            count={filtered.length}
            total={scopedDrawings.length}
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
                <SortableHeader
                  label="Document"
                  column="docNumber"
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
              {sorted.map((d) => {
                const matCount = (d.materials || []).length;
                const cfgCount = (d.sbConfigIds || []).length;
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
                      <td title={d.title || ''}>
                        {d.title ? (
                          <span className="cell-truncate">{d.title}</span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td className="dim col-meta">
                        {matCount} material{matCount === 1 ? '' : 's'} ·{' '}
                        {cfgCount === 0
                          ? 'all configs'
                          : `${cfgCount} config${cfgCount === 1 ? '' : 's'}`}{' '}
                        · {refCount} ref{refCount === 1 ? '' : 's'}
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
                            configs={configs}
                            materialById={materialById}
                            materialByPN={materialByPN}
                            configById={configById}
                            sbById={sbById}
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

// ----- expanded view: materials, referenced drawings, SB configs -----

function DrawingDetail({
  drawing,
  drawings,
  materials,
  configs,
  materialById,
  materialByPN,
  configById,
  sbById,
  drawingById,
  isAdmin,
}) {
  const drawingRef = doc(db, COLLECTIONS.DRAWING, drawing.id);
  const matLinks = drawing.materials || [];
  const cfgLinks = drawing.sbConfigIds || [];
  const refIds = drawing.refDrawingIds || [];

  // ----- inline edits for the drawing's own fields -----
  async function updateDocNumber(value) {
    const v = (value || '').trim();
    if (!v || v === drawing.docNumber) return;
    await updateDoc(drawingRef, { docNumber: v });
  }
  async function updateRev(value) {
    const v = (value || '').trim();
    if (v === (drawing.rev || '')) return;
    await updateDoc(drawingRef, { rev: v });
  }
  async function updateTitle(value) {
    const v = (value || '').trim();
    if (v === (drawing.title || '')) return;
    await updateDoc(drawingRef, { title: v });
  }

  // Which kit-materials are expanded to show their contents.
  const [expandedKits, setExpandedKits] = useState(() => new Set());

  function toggleKit(id) {
    setExpandedKits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  // ----- SB configurations this drawing applies to -----
  const addableConfigs = configs.filter((c) => !cfgLinks.includes(c.id));

  function configLabel(c) {
    return sbById.get(c.sbId)?.sbRef || '';
  }

  async function addConfigs(ids) {
    await updateDoc(drawingRef, { sbConfigIds: [...cfgLinks, ...ids] });
  }

  async function removeConfig(configId) {
    await updateDoc(drawingRef, {
      sbConfigIds: cfgLinks.filter((id) => id !== configId),
    });
  }

  return (
    <div className="detail-panel">
      {isAdmin && (
        <div className="detail-section">
          <p className="detail-section-title">Details</p>
          <div className="form-row">
            <div className="field">
              <label>Document number</label>
              <input
                className="input mono"
                defaultValue={drawing.docNumber}
                key={'dn' + drawing.docNumber}
                onBlur={(e) => updateDocNumber(e.target.value)}
              />
            </div>
            <div className="field field-rev">
              <label>Rev</label>
              <input
                className="input mono"
                defaultValue={drawing.rev || ''}
                key={'rv' + (drawing.rev || '')}
                onBlur={(e) => updateRev(e.target.value)}
              />
            </div>
            <div className="field field-wide">
              <label>Title</label>
              <input
                className="input"
                defaultValue={drawing.title || ''}
                key={'tt' + (drawing.title || '')}
                onBlur={(e) => updateTitle(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

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
              const comps = Array.isArray(m?.components) ? m.components : [];
              const isKit = !!m?.isKit && comps.length > 0;
              const kitOpen = isKit && expandedKits.has(link.materialId);
              return (
                <Fragment key={link.materialId}>
                  <li className="link-row">
                    {isKit ? (
                      <button
                        className="expand-btn"
                        onClick={() => toggleKit(link.materialId)}
                        aria-label={kitOpen ? 'Collapse' : 'Expand'}
                      >
                        {kitOpen ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="link-caret-spacer" />
                    )}
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
                    <AlternatesChip materialId={link.materialId} />
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
                  {kitOpen && (
                    <li className="kit-subtree">
                      <KitContents
                        components={comps}
                        byId={materialById}
                        seen={new Set([m.id])}
                      />
                    </li>
                  )}
                </Fragment>
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

      {/* ---- SB configurations this drawing applies to ---- */}
      <div className="detail-section">
        <p className="detail-section-title">Applies to SB configurations</p>

        {cfgLinks.length === 0 ? (
          <p className="kit-empty">
            No configurations selected — this drawing applies to all
            configurations of its bulletin.
          </p>
        ) : (
          <div className="chip-row">
            {cfgLinks.map((id) => {
              const c = configById.get(id);
              const sbref = c ? configLabel(c) : '';
              return (
                <span key={id} className="chip">
                  <span className="mono">
                    {c ? c.name : '(missing config)'}
                  </span>
                  {sbref && <span className="dim">{sbref}</span>}
                  {isAdmin && (
                    <button
                      className="chip-x"
                      onClick={() => removeConfig(id)}
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
            placeholder="Add SB configurations…"
            onAdd={addConfigs}
            options={addableConfigs.map((c) => ({
              id: c.id,
              label: c.name,
              sublabel: configLabel(c),
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
