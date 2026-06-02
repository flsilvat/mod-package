import { useState } from 'react';
import { Link } from 'react-router-dom';
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
import { formatDateDMY } from '../lib/format';

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
  const toRef = doc(db, COLLECTIONS.TECHNICAL_ORDER, to.id);
  const sortedParts = [...parts].sort((a, b) =>
    (a.partLabel || '').localeCompare(b.partLabel || '')
  );

  // ----- inline edit for the TO number -----
  async function updateToNumber(value) {
    const v = (value || '').trim();
    if (!v || v === to.toNumber) return;
    await updateDoc(toRef, { toNumber: v });
  }

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
      {isAdmin && (
        <div className="detail-section">
          <p className="detail-section-title">Details</p>
          <div className="form-row">
            <div className="field">
              <label>TO number</label>
              <input
                className="input mono"
                defaultValue={to.toNumber}
                key={'n' + to.toNumber}
                onBlur={(e) => updateToNumber(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <div className="detail-section">
        <p className="detail-section-title">Parts of {to.toNumber}</p>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--ink-soft)',
            margin: '0 0 12px',
          }}
        >
          Built from bulletin{' '}
          {sb ? (
            <>
              {sb.sbRef}
              {sb.rev ? ` rev ${sb.rev}` : ''}
            </>
          ) : (
            '(missing bulletin)'
          )}
          . Each part covers one of its configurations and points to one HTL.
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

  // Free-text fields (justification, tech comments). Stored verbatim so line
  // breaks are preserved; only no-op saves are skipped.
  async function changeText(field, value) {
    if ((part[field] || '') === value) return;
    await updateDoc(partRef, { [field]: value });
  }

  // Check level: a whole number 1–7, the string "Special", or empty to clear.
  // Stored as a number for 1–7 so it sorts/compares numerically, and as the
  // literal string for "Special".
  async function changeCheckLevel(value) {
    const raw = value || '';
    const next = raw === '' ? null : raw === 'Special' ? 'Special' : Number(raw);
    if (next === (part.checkLevel ?? null)) return;
    await updateDoc(partRef, { checkLevel: next });
  }

  async function changeEndDate(value) {
    const v = value || '';
    if ((part.endDate || '') === v) return;
    await updateDoc(partRef, { endDate: v });
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
          <Link to={`/to-part/${part.id}`} className="btn btn-ghost btn-sm">
            Open full view →
          </Link>
        </div>
        <p className="op-readline">
          <span className="op-field-label">Covers configuration:</span>{' '}
          {config ? config.name : <span className="dim">not set</span>}
        </p>
        <p className="op-readline">
          <span className="op-field-label">Uses HTL:</span>{' '}
          {htl ? htl.htlRef : <span className="dim">not set</span>}
        </p>

        <ReadField label="Justification" value={part.justification} multiline />
        <ReadField
          label="Tech comments for Planning"
          value={part.techCommentsPlanning}
          multiline
        />
        <ReadField
          label="Tech comments for Materials"
          value={part.techCommentsMaterials}
          multiline
        />
        <p className="op-readline">
          <span className="op-field-label">Check level:</span>{' '}
          {part.checkLevel != null ? (
            part.checkLevel
          ) : (
            <span className="dim">not set</span>
          )}
        </p>
        <p className="op-readline">
          <span className="op-field-label">End date:</span>{' '}
          {part.endDate ? (
            formatDateDMY(part.endDate)
          ) : (
            <span className="dim">not set</span>
          )}
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
        <Link to={`/to-part/${part.id}`} className="btn btn-ghost btn-sm">
          Open full view →
        </Link>
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

      <label className="op-field">
        <span className="op-field-label">Justification</span>
        <textarea
          className="op-text"
          rows={4}
          defaultValue={part.justification || ''}
          key={'just' + part.id}
          onBlur={(e) => changeText('justification', e.target.value)}
          placeholder="Why this part exists…"
        />
      </label>

      <label className="op-field">
        <span className="op-field-label">Tech comments for Planning</span>
        <textarea
          className="op-text"
          rows={4}
          defaultValue={part.techCommentsPlanning || ''}
          key={'plan' + part.id}
          onBlur={(e) => changeText('techCommentsPlanning', e.target.value)}
          placeholder="Notes for Planning…"
        />
      </label>

      <label className="op-field">
        <span className="op-field-label">Tech comments for Materials</span>
        <textarea
          className="op-text"
          rows={4}
          defaultValue={part.techCommentsMaterials || ''}
          key={'mat' + part.id}
          onBlur={(e) => changeText('techCommentsMaterials', e.target.value)}
          placeholder="Notes for Materials…"
        />
      </label>

      <label className="op-field">
        <span className="op-field-label">Check level</span>
        <select
          className="input select"
          value={part.checkLevel ?? ''}
          onChange={(e) => changeCheckLevel(e.target.value)}
        >
          <option value="">— choose check level —</option>
          <option value="Special">Special</option>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <label className="op-field">
        <span className="op-field-label">End date</span>
        <input
          className="input"
          type="date"
          defaultValue={part.endDate || ''}
          key={'end' + part.id + (part.endDate || '')}
          onBlur={(e) => changeEndDate(e.target.value)}
        />
      </label>
    </div>
  );
}

// ----- read-only field for the viewer card: label + value (or "not set").
//       `multiline` renders the value in a pre-wrap box so paragraph breaks
//       in the tech comments / justification are preserved. -----

function ReadField({ label, value, multiline }) {
  const v = (value || '').trim();
  if (multiline) {
    return (
      <div className="op-field">
        <span className="op-field-label">{label}</span>
        {v ? (
          <p className="op-readtext">{value}</p>
        ) : (
          <p className="op-readline dim">not set</p>
        )}
      </div>
    );
  }
  return (
    <p className="op-readline">
      <span className="op-field-label">{label}:</span>{' '}
      {v ? value : <span className="dim">not set</span>}
    </p>
  );
}
