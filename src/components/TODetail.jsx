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

// ----- expanded view for one Technical Order: its parts -----

export default function TODetail({
  to,
  sb,
  parts,
  configs,
  htls,
  configById,
  htlById,
  isAdmin,
}) {
  const sortedParts = [...parts].sort((a, b) =>
    (a.partLabel || '').localeCompare(b.partLabel || '')
  );

  const [partLabel, setPartLabel] = useState(`Part ${parts.length + 1}`);

  async function addPart(event) {
    event.preventDefault();
    const label = partLabel.trim();
    if (!label) return;
    await addDoc(collection(db, COLLECTIONS.TO_PART), {
      technicalOrderId: to.id,
      partLabel: label,
      sbConfigId: '',
      htlId: '',
      createdAt: serverTimestamp(),
    });
    setPartLabel(`Part ${parts.length + 2}`);
  }

  return (
    <div className="detail-panel">
      <div className="detail-section">
        <p className="detail-section-title">Parts of {to.toNumber}</p>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--ink-soft)',
            margin: '0 0 12px',
          }}
        >
          Built from bulletin {sb ? sb.sbRef : '(missing bulletin)'}. Each part
          covers one of its configurations and points to one HTL.
        </p>

        {sortedParts.length === 0 ? (
          <p className="kit-empty">No parts yet.</p>
        ) : (
          sortedParts.map((part) => (
            <TOPartCard
              key={part.id}
              part={part}
              configs={configs}
              htls={htls}
              configById={configById}
              htlById={htlById}
              isAdmin={isAdmin}
            />
          ))
        )}

        {isAdmin && configs.length === 0 && (
          <p className="notice">
            This bulletin has no configurations yet — add them on the Service
            Bulletin before a part can cover one.
          </p>
        )}
        {isAdmin && htls.length === 0 && (
          <p className="notice">
            No HTLs exist yet — create them before assigning one to a part.
          </p>
        )}

        {isAdmin && (
          <form className="link-add" onSubmit={addPart}>
            <input
              className="input"
              placeholder="Part label (e.g. Part 1)"
              value={partLabel}
              onChange={(e) => setPartLabel(e.target.value)}
              aria-label="Part label"
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!partLabel.trim()}
            >
              Add part
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ----- one TO part: covers one SB config, uses one HTL -----

function TOPartCard({ part, configs, htls, configById, htlById, isAdmin }) {
  const partRef = doc(db, COLLECTIONS.TO_PART, part.id);
  const config = configById.get(part.sbConfigId);
  const htl = htlById.get(part.htlId);

  async function renameLabel(value) {
    const v = value.trim();
    if (!v || v === part.partLabel) return;
    await updateDoc(partRef, { partLabel: v });
  }

  async function changeConfig(value) {
    await updateDoc(partRef, { sbConfigId: value });
  }

  async function changeHtl(value) {
    await updateDoc(partRef, { htlId: value });
  }

  async function remove() {
    if (!window.confirm(`Delete "${part.partLabel}"?`)) return;
    await deleteDoc(partRef);
  }

  if (!isAdmin) {
    return (
      <div className="config-card">
        <div className="config-card-head">
          <span className="config-name-static">{part.partLabel}</span>
        </div>
        <p className="op-readline">
          <span className="op-field-label">Covers configuration:</span>{' '}
          {config ? config.name : <span className="dim">not set</span>}
        </p>
        <p className="op-readline">
          <span className="op-field-label">Uses HTL:</span>{' '}
          {htl ? htl.htlRef : <span className="dim">not set</span>}
        </p>
      </div>
    );
  }

  return (
    <div className="config-card">
      <div className="config-card-head">
        <input
          className="input config-name"
          defaultValue={part.partLabel}
          key={part.partLabel}
          onBlur={(e) => renameLabel(e.target.value)}
          aria-label="Part label"
        />
        <button className="btn btn-ghost btn-sm" onClick={remove}>
          Delete
        </button>
      </div>

      <label className="op-field">
        <span className="op-field-label">Covers configuration</span>
        <select
          className="input select"
          value={part.sbConfigId || ''}
          onChange={(e) => changeConfig(e.target.value)}
        >
          <option value="">— choose configuration —</option>
          {configs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({(c.aircraftIds || []).length} aircraft)
            </option>
          ))}
        </select>
      </label>

      <label className="op-field">
        <span className="op-field-label">Uses HTL</span>
        <select
          className="input select"
          value={part.htlId || ''}
          onChange={(e) => changeHtl(e.target.value)}
        >
          <option value="">— choose HTL —</option>
          {htls.map((h) => (
            <option key={h.id} value={h.id}>
              {h.htlRef} ({(h.children || []).length} items)
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
