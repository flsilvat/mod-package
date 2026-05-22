import { useMemo } from 'react';
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
import { useScope } from '../lib/scope';
import { useAuth } from '../lib/auth';
import MultiSelect from './MultiSelect';

// The Alternates editor that lives inside a material's detail row on the
// Materials page. Shows the current group's note + other members as chips,
// lets admins add/remove members and edit the note. A material can belong
// to at most one group, so the picker hides materials already taken by
// another group.

export default function AlternatesSection({ material }) {
  const { isAdmin } = useAuth();
  const {
    interchangeGroups,
    groupByMaterialId,
    materialById,
    materials,
  } = useScope();

  const group = groupByMaterialId.get(material.id) || null;

  // Materials available for this row: not in any OTHER group, not in this
  // group, and not this material itself.
  const available = useMemo(() => {
    const taken = new Set();
    for (const g of interchangeGroups) {
      if (group && g.id === group.id) continue;
      const ids = Array.isArray(g.materialIds) ? g.materialIds : [];
      for (const id of ids) taken.add(id);
    }
    taken.add(material.id);
    if (group) for (const id of group.materialIds || []) taken.add(id);
    return materials.filter((m) => !taken.has(m.id));
  }, [interchangeGroups, group, material.id, materials]);

  async function createGroupWith(otherIds) {
    if (!otherIds.length) return;
    await addDoc(collection(db, COLLECTIONS.INTERCHANGE_GROUP), {
      materialIds: [material.id, ...otherIds],
      note: '',
      createdAt: serverTimestamp(),
    });
  }

  async function addToGroup(ids) {
    if (!group || !ids.length) return;
    await updateDoc(doc(db, COLLECTIONS.INTERCHANGE_GROUP, group.id), {
      materialIds: [...(group.materialIds || []), ...ids],
    });
  }

  async function removeFromGroup(idToRemove) {
    if (!group) return;
    const remaining = (group.materialIds || []).filter(
      (id) => id !== idToRemove
    );
    // a group with fewer than 2 members no longer means anything — drop it
    if (remaining.length < 2) {
      await deleteDoc(doc(db, COLLECTIONS.INTERCHANGE_GROUP, group.id));
    } else {
      await updateDoc(doc(db, COLLECTIONS.INTERCHANGE_GROUP, group.id), {
        materialIds: remaining,
      });
    }
  }

  async function updateNote(value) {
    if (!group) return;
    const v = value || '';
    if (v === (group.note || '')) return;
    await updateDoc(doc(db, COLLECTIONS.INTERCHANGE_GROUP, group.id), {
      note: v,
    });
  }

  const otherIds = group
    ? (group.materialIds || []).filter((id) => id !== material.id)
    : [];

  return (
    <div className="detail-section">
      <p className="detail-section-title">Alternates</p>

      {!group ? (
        <p className="kit-empty">No interchangeable alternates yet.</p>
      ) : (
        <>
          {isAdmin ? (
            <input
              className="input alternate-note"
              placeholder="Note: justification for this group…"
              defaultValue={group.note || ''}
              key={'n' + group.id + (group.note || '')}
              onBlur={(e) => updateNote(e.target.value)}
              aria-label="Group note"
            />
          ) : group.note ? (
            <p className="alternate-note-readonly">{group.note}</p>
          ) : null}

          {otherIds.length === 0 ? (
            <p className="kit-empty">No other members in this group.</p>
          ) : (
            <div className="chip-row">
              {otherIds.map((id) => {
                const m = materialById.get(id);
                return (
                  <span key={id} className="chip">
                    <span className="mono">
                      {m ? m.partNumber : '(missing)'}
                    </span>
                    {m?.description && (
                      <span className="dim">{m.description}</span>
                    )}
                    {isAdmin && (
                      <button
                        className="chip-x"
                        onClick={() => removeFromGroup(id)}
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
        </>
      )}

      {isAdmin && (
        <MultiSelect
          placeholder={
            group ? 'Add more alternates…' : 'Mark as interchangeable with…'
          }
          onAdd={(ids) => (group ? addToGroup(ids) : createGroupWith(ids))}
          options={available.map((m) => ({
            id: m.id,
            label: m.partNumber,
            sublabel: (m.description || '') + (m.isKit ? '  [kit]' : ''),
          }))}
        />
      )}
    </div>
  );
}
