import { useState, Fragment } from 'react';
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
import { computeConfigBucket, kitTally, collectDrawingsForConfig } from '../lib/bucket';
import BatchInput from './BatchInput';
import MultiSelect from './MultiSelect';
import KitContents from './KitContents';
import CollapsibleKitTree from './CollapsibleKitTree';
import AlternatesChip from './AlternatesChip';

// ----- expanded view for one Service Bulletin -----

export default function SBDetail({
  sb,
  configs,
  materials,
  aircraft,
  drawingById,
  materialById,
  materialByPN,
  aircraftById,
  isAdmin,
}) {
  const sbRef = doc(db, COLLECTIONS.SERVICE_BULLETIN, sb.id);
  const matLinks = sb.materials || [];

  // ----- inline edits for the bulletin's own fields -----
  async function updateSbRef(value) {
    const v = (value || '').trim();
    if (!v || v === sb.sbRef) return;
    await updateDoc(sbRef, { sbRef: v });
  }
  async function updateRev(value) {
    const v = (value || '').trim();
    if (v === (sb.rev || '')) return;
    await updateDoc(sbRef, { rev: v });
  }
  async function updateTitle(value) {
    const v = (value || '').trim();
    if (v === (sb.title || '')) return;
    await updateDoc(sbRef, { title: v });
  }

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

  // ----- materials required -----
  const addableMaterials = materials.filter(
    (m) => !matLinks.some((l) => l.materialId === m.id)
  );

  async function addMaterials(ids) {
    await updateDoc(sbRef, {
      materials: [
        ...matLinks,
        ...ids.map((id) => ({ materialId: id, qty: 1 })),
      ],
    });
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

  return (
    <div className="detail-panel">
      {isAdmin && (
        <div className="detail-section">
          <p className="detail-section-title">Details</p>
          <div className="form-row">
            <div className="field">
              <label>SB reference</label>
              <input
                className="input mono"
                defaultValue={sb.sbRef}
                key={'r' + sb.sbRef}
                onBlur={(e) => updateSbRef(e.target.value)}
              />
            </div>
            <div className="field field-rev">
              <label>Rev</label>
              <input
                className="input mono"
                defaultValue={sb.rev || ''}
                key={'rv' + (sb.rev || '')}
                onBlur={(e) => updateRev(e.target.value)}
              />
            </div>
            <div className="field field-wide">
              <label>Title</label>
              <input
                className="input"
                defaultValue={sb.title || ''}
                key={'t' + (sb.title || '')}
                onBlur={(e) => updateTitle(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

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
              materialById={materialById}
              bucket={computeConfigBucket(config, {
                sb,
                drawingById,
                materialById,
              })}
              applicableDrawings={collectDrawingsForConfig(config.id, {
                drawingById,
              })}
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
                  return 'already on this bulletin';
                if (!(Number(r.qty) > 0)) return 'quantity must be > 0';
                return null;
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ----- one configuration: a named grouping of aircraft + its bucket -----

function ConfigCard({
  config,
  aircraft,
  aircraftById,
  materialById,
  bucket,
  applicableDrawings,
  isAdmin,
}) {
  const configRef = doc(db, COLLECTIONS.SB_CONFIG, config.id);
  const acIds = config.aircraftIds || [];

  const addableAircraft = aircraft.filter((a) => !acIds.includes(a.id));

  // Which kit-materials in the bucket are expanded to show their contents.
  const [openKits, setOpenKits] = useState(() => new Set());

  function toggleKit(id) {
    setOpenKits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function rename(value) {
    const name = value.trim();
    if (!name || name === config.name) return;
    await updateDoc(configRef, { name });
  }

  async function addAircrafts(ids) {
    await updateDoc(configRef, { aircraftIds: [...acIds, ...ids] });
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

      {/* ---- applicable drawings (recursive via refs) ---- */}
      <div className="config-bucket">
        <p className="detail-section-title">
          Drawings
          {applicableDrawings.length > 0 && (
            <span className="dim">
              {' '}
              · {applicableDrawings.length} drawing
              {applicableDrawings.length === 1 ? '' : 's'}
            </span>
          )}
        </p>

        {applicableDrawings.length === 0 ? (
          <p className="kit-empty">
            No drawings reach this configuration yet — link drawings to it on
            the Drawings page.
          </p>
        ) : (
          <ul className="link-list">
            {applicableDrawings.map((d) => (
              <li key={d.id} className="link-row">
                <span className="mono strong">{d.docNumber}</span>
                {d.rev && <span className="tag tag-count">rev {d.rev}</span>}
                {d.sapDir && <span className="dim">({d.sapDir})</span>}
                {d.title && (
                  <span className="kit-desc" title={d.title}>
                    {d.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- computed materials bucket ---- */}
      <div className="config-bucket">
        <p className="detail-section-title">
          Materials bucket
          {bucket.length > 0 && (
            <span className="dim">
              {' '}
              · {bucket.length} line{bucket.length === 1 ? '' : 's'}
            </span>
          )}
        </p>

        {bucket.length === 0 ? (
          <p className="kit-empty">
            No materials reach this configuration yet — add materials to the
            bulletin, or applicable drawings.
          </p>
        ) : (
          <ul className="link-list">
            {bucket.map((line) => {
              const m = materialById.get(line.materialId);
              const comps = Array.isArray(m?.components) ? m.components : [];
              const isKit = !!m?.isKit && comps.length > 0;
              const kitOpen = isKit && openKits.has(line.materialId);
              const tally = isKit
                ? kitTally(line.materialId, materialById)
                : null;
              return (
                <Fragment key={line.materialId}>
                  <li className="link-row">
                    {isKit ? (
                      <button
                        className="expand-btn"
                        onClick={() => toggleKit(line.materialId)}
                        aria-label={kitOpen ? 'Collapse' : 'Expand'}
                      >
                        {kitOpen ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="link-caret-spacer" />
                    )}
                    <span className="kit-qty">{line.qty}×</span>
                    <span className="mono strong">
                      {m ? m.partNumber : '(missing material)'}
                    </span>
                    <AlternatesChip materialId={line.materialId} />
                    {m?.description && (
                      <span className="kit-desc">{m.description}</span>
                    )}
                    {m?.isKit && <span className="tag tag-kit">kit</span>}
                    {tally && (
                      <span className="dim">
                        {tally.parts} part{tally.parts === 1 ? '' : 's'}
                        {tally.subkits > 0 &&
                          `, ${tally.subkits} subkit${
                            tally.subkits === 1 ? '' : 's'
                          }`}
                      </span>
                    )}
                  </li>
                  {kitOpen && (
                    <li className="kit-subtree">
                      <CollapsibleKitTree
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
      </div>
    </div>
  );
}
