import { useState } from 'react';
import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from '../lib/collections';
import { findKitsContaining } from '../lib/bucket';
import MultiSelect from './MultiSelect';

// ----- expanded view for one GTL: operations + applicable aircraft -----

export default function GTLDetail({
  gtl,
  operations,
  drawings,
  materials,
  aircraft,
  drawingById,
  materialById,
  aircraftById,
  isAdmin,
}) {
  const gtlRef = doc(db, COLLECTIONS.GTL, gtl.id);
  const acIds = gtl.aircraftIds || [];

  const sortedOps = [...operations].sort(
    (a, b) => (Number(a.opNumber) || 0) - (Number(b.opNumber) || 0)
  );

  // Operation numbers run in tens by convention (10, 20, 30…).
  const nextOpNumber = sortedOps.length
    ? (Number(sortedOps[sortedOps.length - 1].opNumber) || 0) + 10
    : 10;

  // ----- add operation -----
  const [opNum, setOpNum] = useState(String(nextOpNumber));
  const [opText, setOpText] = useState('');
  const [opSkill, setOpSkill] = useState('');
  const [opErr, setOpErr] = useState(null);

  async function addOperation(event) {
    event.preventDefault();
    const n = Number(opNum);
    if (!Number.isFinite(n)) {
      setOpErr('Operation number must be a number.');
      return;
    }
    if (!opText.trim()) {
      setOpErr('The instruction text cannot be empty.');
      return;
    }
    setOpErr(null);
    try {
      await addDoc(collection(db, COLLECTIONS.OPERATION), {
        gtlId: gtl.id,
        opNumber: n,
        text: opText.trim(),
        engineerType: opSkill.trim(),
        drawingIds: [],
        materials: [],
        createdAt: serverTimestamp(),
      });
      setOpNum(String(n + 10));
      setOpText('');
      setOpSkill('');
    } catch (e) {
      setOpErr(e.message);
    }
  }

  // ----- aircraft -----
  const addableAircraft = aircraft.filter((a) => !acIds.includes(a.id));

  async function addAircrafts(ids) {
    await updateDoc(gtlRef, { aircraftIds: [...acIds, ...ids] });
  }

  async function removeAircraft(id) {
    await updateDoc(gtlRef, { aircraftIds: acIds.filter((x) => x !== id) });
  }

  return (
    <div className="detail-panel">
      {/* ---- operations ---- */}
      <div className="detail-section">
        <p className="detail-section-title">Operations in {gtl.gtlRef}</p>

        {sortedOps.length === 0 ? (
          <p className="kit-empty">No operations yet.</p>
        ) : (
          sortedOps.map((op) => (
            <OperationCard
              key={op.id}
              op={op}
              drawings={drawings}
              materials={materials}
              drawingById={drawingById}
              materialById={materialById}
              isAdmin={isAdmin}
            />
          ))
        )}

        {isAdmin && (
          <form className="op-add" onSubmit={addOperation}>
            <div className="op-add-row">
              <label className="op-field">
                <span className="op-field-label">Op number</span>
                <input
                  className="input op-num-input"
                  type="number"
                  value={opNum}
                  onChange={(e) => setOpNum(e.target.value)}
                />
              </label>
              <label className="op-field">
                <span className="op-field-label">Engineer type</span>
                <input
                  className="input op-skill-input"
                  placeholder="B1, B2…"
                  value={opSkill}
                  onChange={(e) => setOpSkill(e.target.value)}
                />
              </label>
            </div>
            <label className="op-field">
              <span className="op-field-label">Instruction</span>
              <textarea
                className="op-text"
                rows={6}
                placeholder="The step the engineer carries out…"
                value={opText}
                onChange={(e) => setOpText(e.target.value)}
              />
            </label>
            <div>
              <button type="submit" className="btn btn-primary btn-sm">
                Add operation
              </button>
              {opErr && <span className="kit-add-err"> {opErr}</span>}
            </div>
          </form>
        )}
      </div>

      {/* ---- applicable aircraft ---- */}
      <div className="detail-section">
        <p className="detail-section-title">Applies to aircraft</p>

        {acIds.length === 0 ? (
          <p className="kit-empty">No aircraft added yet.</p>
        ) : (
          <ul className="link-list">
            {acIds.map((id) => {
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

// ----- one operation: a single SAP step -----

function OperationCard({
  op,
  drawings,
  materials,
  drawingById,
  materialById,
  isAdmin,
}) {
  const [open, setOpen] = useState(false);
  const opRef = doc(db, COLLECTIONS.OPERATION, op.id);
  const drawingIds = op.drawingIds || [];
  const matLinks = op.materials || [];

  async function changeOpNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === Number(op.opNumber)) return;
    await updateDoc(opRef, { opNumber: n });
  }

  async function changeEngineerType(value) {
    const v = value.trim();
    if (v === (op.engineerType || '')) return;
    await updateDoc(opRef, { engineerType: v });
  }

  async function changeText(value) {
    if (value === op.text) return;
    await updateDoc(opRef, { text: value });
  }

  async function addDrawings(ids) {
    await updateDoc(opRef, { drawingIds: [...drawingIds, ...ids] });
  }

  async function removeDrawing(id) {
    await updateDoc(opRef, {
      drawingIds: drawingIds.filter((x) => x !== id),
    });
  }

  async function addMaterials(ids) {
    await updateDoc(opRef, {
      materials: [
        ...matLinks,
        ...ids.map((id) => ({ materialId: id, qty: 1 })),
      ],
    });
  }

  async function removeMaterial(materialId) {
    await updateDoc(opRef, {
      materials: matLinks.filter((l) => l.materialId !== materialId),
    });
  }

  async function changeMaterialQty(materialId, value) {
    const q = Number(value);
    const current = matLinks.find((l) => l.materialId === materialId);
    if (!(q > 0) || !current || current.qty === q) return;
    await updateDoc(opRef, {
      materials: matLinks.map((l) =>
        l.materialId === materialId ? { ...l, qty: q } : l
      ),
    });
  }

  // Set or clear the kit-source tag on a material line. Empty string means
  // "loose / whole" — we strip the fromKitId field to keep the doc clean.
  async function changeMaterialFromKit(materialId, value) {
    const current = matLinks.find((l) => l.materialId === materialId);
    if (!current) return;
    const newKitId = value || null;
    const currentKitId = current.fromKitId || null;
    if (newKitId === currentKitId) return;
    const newLinks = matLinks.map((l) => {
      if (l.materialId !== materialId) return l;
      if (newKitId) return { ...l, fromKitId: newKitId };
      // strip fromKitId
      const next = { ...l };
      delete next.fromKitId;
      return next;
    });
    await updateDoc(opRef, { materials: newLinks });
  }

  async function remove() {
    if (!window.confirm(`Delete operation ${op.opNumber}?`)) return;
    await deleteDoc(opRef);
  }

  const addableDrawings = drawings.filter((d) => !drawingIds.includes(d.id));
  const addableMaterials = materials.filter(
    (m) => !matLinks.some((l) => l.materialId === m.id)
  );

  return (
    <div className="op-card">
      <div className="op-head">
        <button
          className="expand-btn"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="op-number">{op.opNumber}</span>
        <span className="op-snippet">
          {op.text || <span className="dim">(no instruction yet)</span>}
        </span>
        <div className="op-head-meta">
          {op.engineerType && (
            <span className="tag tag-skill">{op.engineerType}</span>
          )}
          {matLinks.length > 0 && (
            <span className="tag tag-count">{matLinks.length}× material</span>
          )}
          {drawingIds.length > 0 && (
            <span className="tag tag-count">{drawingIds.length}× dwg</span>
          )}
        </div>
        {isAdmin && (
          <button className="btn btn-ghost btn-sm" onClick={remove}>
            Delete
          </button>
        )}
      </div>

      {open && (
        <div className="op-body">
          {isAdmin ? (
            <>
              <div className="op-add-row">
                <label className="op-field">
                  <span className="op-field-label">Op number</span>
                  <input
                    className="input op-num-input"
                    type="number"
                    defaultValue={op.opNumber}
                    key={'n' + op.opNumber}
                    onBlur={(e) => changeOpNumber(e.target.value)}
                  />
                </label>
                <label className="op-field">
                  <span className="op-field-label">Engineer type</span>
                  <input
                    className="input op-skill-input"
                    placeholder="B1, B2…"
                    defaultValue={op.engineerType || ''}
                    key={'s' + (op.engineerType || '')}
                    onBlur={(e) => changeEngineerType(e.target.value)}
                  />
                </label>
              </div>
              <label className="op-field">
                <span className="op-field-label">Instruction</span>
                <textarea
                  className="op-text"
                  rows={12}
                  defaultValue={op.text}
                  key={'t' + op.text}
                  onBlur={(e) => changeText(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              {op.engineerType && (
                <p className="op-readline">
                  <span className="op-field-label">Engineer type:</span>{' '}
                  {op.engineerType}
                </p>
              )}
              <p className="op-readtext">{op.text}</p>
            </>
          )}

          {/* drawings referenced by this operation */}
          <div className="op-sub">
            <p className="detail-section-title">Drawings</p>
            {drawingIds.length === 0 ? (
              <p className="kit-empty">No drawings referenced.</p>
            ) : (
              <ul className="link-list">
                {drawingIds.map((id) => {
                  const d = drawingById.get(id);
                  return (
                    <li key={id} className="link-row">
                      <span className="mono strong">
                        {d ? d.docNumber : '(missing drawing)'}
                      </span>
                      {d?.rev && <span className="kit-qty">rev {d.rev}</span>}
                      {d?.title && (
                        <span className="kit-desc">{d.title}</span>
                      )}
                      {isAdmin && (
                        <button
                          className="kit-remove"
                          onClick={() => removeDrawing(id)}
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
                placeholder="Add drawings…"
                onAdd={addDrawings}
                options={addableDrawings.map((d) => ({
                  id: d.id,
                  label: d.docNumber,
                  sublabel: (d.rev ? `rev ${d.rev}  ` : '') + (d.title || ''),
                }))}
              />
            )}
          </div>

          {/* materials used by this operation */}
          <div className="op-sub">
            <p className="detail-section-title">Materials</p>
            {matLinks.length === 0 ? (
              <p className="kit-empty">No materials added.</p>
            ) : (
              <ul className="link-list">
                {matLinks.map((link) => {
                  const m = materialById.get(link.materialId);
                  const kitCandidates = findKitsContaining(
                    link.materialId,
                    materials
                  );
                  const fromKit = link.fromKitId
                    ? materialById.get(link.fromKitId)
                    : null;
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

                      {/* from-kit picker (admin) or label (viewer) */}
                      {isAdmin && kitCandidates.length > 0 && (
                        <select
                          className="input"
                          style={{
                            fontSize: 12,
                            padding: '2px 6px',
                            height: 26,
                            minWidth: 0,
                            maxWidth: 220,
                          }}
                          value={link.fromKitId || ''}
                          onChange={(e) =>
                            changeMaterialFromKit(
                              link.materialId,
                              e.target.value
                            )
                          }
                          aria-label="Source kit"
                        >
                          <option value="">(loose)</option>
                          {kitCandidates.map((k) => (
                            <option key={k.id} value={k.id}>
                              from {k.partNumber}
                            </option>
                          ))}
                        </select>
                      )}
                      {!isAdmin && link.fromKitId && (
                        <span className="tag tag-count">
                          from {fromKit ? fromKit.partNumber : '(missing kit)'}
                        </span>
                      )}

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
            )}
          </div>
        </div>
      )}
    </div>
  );
}
