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
import BatchInput from './BatchInput';

// Common aircraft manual types — free text is still allowed.
const MANUAL_TYPES = ['AMM', 'SRM', 'IPC', 'CMM', 'WDM', 'TSM', 'FIM', 'NTM', 'AWM'];

// ----- expanded view for one Service Bulletin -----

export default function SBDetail({
  sb,
  configs,
  drawings,
  materials,
  aircraft,
  drawingById,
  materialById,
  materialByPN,
  aircraftById,
  isAdmin,
}) {
  const sbRef = doc(db, COLLECTIONS.SERVICE_BULLETIN, sb.id);
  const drawingIds = sb.drawingIds || [];
  const matLinks = sb.materials || [];
  const manualRefs = sb.manualRefs || [];

  // ----- configurations -----
  const [configName, setConfigName] = useState('');
  const sortedConfigs = [...configs].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  );

  async function addConfig(event) {
    event.preventDefault();
    const name = configName.trim();
    if (!name) return;
    await addDoc(collection(db, COLLECTIONS.SB_CONFIG), {
      sbId: sb.id,
      name,
      aircraftIds: [],
      createdAt: serverTimestamp(),
    });
    setConfigName('');
  }

  // ----- drawings referenced -----
  const [drawPick, setDrawPick] = useState('');
  const addableDrawings = drawings.filter((d) => !drawingIds.includes(d.id));

  async function addDrawing(event) {
    event.preventDefault();
    if (!drawPick) return;
    await updateDoc(sbRef, { drawingIds: [...drawingIds, drawPick] });
    setDrawPick('');
  }

  async function removeDrawing(id) {
    await updateDoc(sbRef, {
      drawingIds: drawingIds.filter((x) => x !== id),
    });
  }

  // ----- materials required -----
  const [matPick, setMatPick] = useState('');
  const [matQty, setMatQty] = useState('1');
  const [matErr, setMatErr] = useState(null);
  const addableMaterials = materials.filter(
    (m) => !matLinks.some((l) => l.materialId === m.id)
  );

  async function addMaterial(event) {
    event.preventDefault();
    if (!matPick) return;
    const q = Number(matQty);
    if (!(q > 0)) {
      setMatErr('Quantity must be greater than zero.');
      return;
    }
    setMatErr(null);
    try {
      await updateDoc(sbRef, {
        materials: [...matLinks, { materialId: matPick, qty: q }],
      });
      setMatPick('');
      setMatQty('1');
    } catch (e) {
      setMatErr(e.message);
    }
  }

  async function removeMaterial(materialId) {
    await updateDoc(sbRef, {
      materials: matLinks.filter((l) => l.materialId !== materialId),
    });
  }

  async function changeMaterialQty(materialId, value) {
    const q = Number(value);
    const current = matLinks.find((l) => l.materialId === materialId);
    if (!(q > 0) || !current || current.qty === q) return;
    await updateDoc(sbRef, {
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
      await updateDoc(sbRef, { materials: [...matLinks, ...additions] });
    }
  }

  // ----- manual references -----
  const [mType, setMType] = useState('');
  const [mRef, setMRef] = useState('');

  async function addManualRef(event) {
    event.preventDefault();
    const type = mType.trim().toUpperCase();
    const ref = mRef.trim();
    if (!type || !ref) return;
    await updateDoc(sbRef, {
      manualRefs: [...manualRefs, { type, ref }],
    });
    setMType('');
    setMRef('');
  }

  async function removeManualRef(index) {
    await updateDoc(sbRef, {
      manualRefs: manualRefs.filter((_, i) => i !== index),
    });
  }

  return (
    <div className="detail-panel">
      {/* ---- configurations ---- */}
      <div className="detail-section">
        <p className="detail-section-title">
          Configurations of {sb.sbRef}
        </p>

        {sortedConfigs.length === 0 ? (
          <p className="kit-empty">No configurations yet.</p>
        ) : (
          sortedConfigs.map((config) => (
            <ConfigCard
              key={config.id}
              config={config}
              aircraft={aircraft}
              aircraftById={aircraftById}
              isAdmin={isAdmin}
            />
          ))
        )}

        {isAdmin && (
          <form className="link-add" onSubmit={addConfig}>
            <input
              className="input"
              placeholder="Configuration name (e.g. Config 1)"
              value={configName}
              onChange={(e) => setConfigName(e.target.value)}
              aria-label="Configuration name"
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!configName.trim()}
            >
              Add configuration
            </button>
          </form>
        )}
      </div>

      {/* ---- drawings referenced ---- */}
      <div className="detail-section">
        <p className="detail-section-title">Drawings referenced</p>

        {drawingIds.length === 0 ? (
          <p className="kit-empty">No drawings referenced yet.</p>
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
                  {d?.title && <span className="kit-desc">{d.title}</span>}
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
          <form className="link-add" onSubmit={addDrawing}>
            <select
              className="input select"
              value={drawPick}
              onChange={(e) => setDrawPick(e.target.value)}
            >
              <option value="">Reference a drawing…</option>
              {addableDrawings.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.docNumber}
                  {d.rev ? ` rev ${d.rev}` : ''}
                  {d.title ? ` — ${d.title}` : ''}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!drawPick}
            >
              Add
            </button>
          </form>
        )}
      </div>

      {/* ---- materials required ---- */}
      <div className="detail-section">
        <p className="detail-section-title">Materials required</p>

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
              {matErr && <span className="kit-add-err">{matErr}</span>}
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
                  return 'already on this bulletin';
                if (!(Number(r.qty) > 0)) return 'quantity must be > 0';
                return null;
              }}
            />
          </>
        )}
      </div>

      {/* ---- manual references ---- */}
      <div className="detail-section">
        <p className="detail-section-title">Manual references</p>

        {manualRefs.length === 0 ? (
          <p className="kit-empty">No manual references yet.</p>
        ) : (
          <ul className="link-list">
            {manualRefs.map((mr, index) => (
              <li key={index} className="link-row">
                <span className="tag tag-manual">{mr.type}</span>
                <span className="mono strong">{mr.ref}</span>
                {isAdmin && (
                  <button
                    className="kit-remove"
                    onClick={() => removeManualRef(index)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {isAdmin && (
          <form className="link-add" onSubmit={addManualRef}>
            <input
              className="input field-rev"
              placeholder="Type"
              value={mType}
              onChange={(e) => setMType(e.target.value)}
              list="manual-types"
              aria-label="Manual type"
            />
            <datalist id="manual-types">
              {MANUAL_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <input
              className="input"
              placeholder="Reference (e.g. 25-21-00)"
              value={mRef}
              onChange={(e) => setMRef(e.target.value)}
              aria-label="Manual reference"
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!mType.trim() || !mRef.trim()}
            >
              Add
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ----- one configuration: a named grouping of aircraft -----

function ConfigCard({ config, aircraft, aircraftById, isAdmin }) {
  const configRef = doc(db, COLLECTIONS.SB_CONFIG, config.id);
  const acIds = config.aircraftIds || [];
  const [acPick, setAcPick] = useState('');

  const addableAircraft = aircraft.filter((a) => !acIds.includes(a.id));

  async function rename(value) {
    const name = value.trim();
    if (!name || name === config.name) return;
    await updateDoc(configRef, { name });
  }

  async function addAircraft(event) {
    event.preventDefault();
    if (!acPick) return;
    await updateDoc(configRef, { aircraftIds: [...acIds, acPick] });
    setAcPick('');
  }

  async function removeAircraft(id) {
    await updateDoc(configRef, {
      aircraftIds: acIds.filter((x) => x !== id),
    });
  }

  async function deleteConfig() {
    if (!window.confirm(`Delete configuration "${config.name}"?`)) return;
    await deleteDoc(configRef);
  }

  return (
    <div className="config-card">
      <div className="config-card-head">
        {isAdmin ? (
          <input
            className="input config-name"
            defaultValue={config.name}
            key={config.name}
            onBlur={(e) => rename(e.target.value)}
            aria-label="Configuration name"
          />
        ) : (
          <span className="config-name-static">{config.name}</span>
        )}
        {isAdmin && (
          <button className="btn btn-ghost btn-sm" onClick={deleteConfig}>
            Delete
          </button>
        )}
      </div>

      <div className="config-aircraft">
        {acIds.length === 0 ? (
          <span className="dim">No aircraft in this configuration.</span>
        ) : (
          <div className="chip-row">
            {acIds.map((id) => {
              const a = aircraftById.get(id);
              return (
                <span key={id} className="chip">
                  <span className="mono">
                    {a ? a.registration : '(missing)'}
                  </span>
                  {isAdmin && (
                    <button
                      className="chip-x"
                      onClick={() => removeAircraft(id)}
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
      </div>

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
  );
}
