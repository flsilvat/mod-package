import { useState, useEffect } from 'react';
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
import BatchInput from '../components/BatchInput';

// A starter list of fleet types — free text is still allowed.
const FLEET_TYPES = ['777-200', '777-300', '787-8', '787-9', '787-10', 'A320', 'A350-1000'];

export default function AircraftPage() {
  const { isAdmin } = useAuth();

  const [aircraft, setAircraft] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Form fields
  const [registration, setRegistration] = useState('');
  const [fleetType, setFleetType] = useState('');
  const [saving, setSaving] = useState(false);

  // Live subscription: the list updates by itself whenever the data changes,
  // here or on anyone else's screen. The returned function unsubscribes.
  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.AIRCRAFT),
      orderBy('registration')
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setAircraft(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, []);

  async function handleAdd(event) {
    event.preventDefault();
    const reg = registration.trim().toUpperCase();
    if (!reg) return;
    if (aircraft.some((a) => a.registration.toUpperCase() === reg)) {
      setError(`Aircraft ${reg} already exists.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addDoc(collection(db, COLLECTIONS.AIRCRAFT), {
        registration: reg,
        fleetType: fleetType.trim(),
        createdAt: serverTimestamp(),
      });
      setRegistration('');
      setFleetType('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Bulk add — commits in chunks (Firestore caps a batch at 500 writes).
  async function importAircraft(rows) {
    const existing = new Set(aircraft.map((a) => a.registration.toUpperCase()));
    const toAdd = [];
    for (const row of rows) {
      const reg = (row.registration || '').trim().toUpperCase();
      if (!reg || existing.has(reg)) continue;
      existing.add(reg);
      toAdd.push({
        registration: reg,
        fleetType: (row.fleetType || '').trim(),
        createdAt: serverTimestamp(),
      });
    }
    for (const group of chunk(toAdd, 450)) {
      const batch = writeBatch(db);
      for (const data of group) {
        batch.set(doc(collection(db, COLLECTIONS.AIRCRAFT)), data);
      }
      await batch.commit();
    }
  }

  async function handleDelete(id, reg) {
    if (!window.confirm(`Remove aircraft ${reg}?`)) return;
    setError(null);
    try {
      await deleteDoc(doc(db, COLLECTIONS.AIRCRAFT, id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">Entity</p>
        <h1>Aircraft</h1>
        <p className="lede">
          The aircraft a modification can apply to. Each one has a registration
          and a fleet type.
        </p>
      </div>

      {/* Only admins can add. Viewers don't see this panel at all. */}
      {isAdmin && (
        <section className="panel">
          <h2 className="panel-title">Add an aircraft</h2>
          <form className="form-row" onSubmit={handleAdd}>
            <div className="field">
              <label htmlFor="reg">Registration</label>
              <input
                id="reg"
                className="input mono"
                placeholder="G-ABCD"
                value={registration}
                onChange={(e) => setRegistration(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="fleet">Fleet type</label>
              <input
                id="fleet"
                className="input"
                placeholder="777-200"
                value={fleetType}
                onChange={(e) => setFleetType(e.target.value)}
                list="fleet-types"
                autoComplete="off"
              />
              <datalist id="fleet-types">
                {FLEET_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add aircraft'}
            </button>
          </form>
          {error && <p className="notice notice-error">{error}</p>}

          <BatchInput
            noun="aircraft"
            onImport={importAircraft}
            fields={[
              { key: 'registration', label: 'Registration', required: true },
              { key: 'fleetType', label: 'Fleet type' },
            ]}
            validateRow={(r) =>
              aircraft.some(
                (a) =>
                  a.registration.toUpperCase() ===
                  (r.registration || '').trim().toUpperCase()
              )
                ? 'already exists'
                : null
            }
          />
        </section>
      )}

      <section className="panel">
        <div className="panel-titlebar">
          <h2 className="panel-title">Fleet</h2>
          <span className="count">{aircraft.length}</span>
        </div>

        {loading ? (
          <p className="notice">Loading…</p>
        ) : aircraft.length === 0 ? (
          <p className="notice">
            No aircraft yet.
            {isAdmin
              ? ' Add one above, or bulk add a list.'
              : ' An admin can add the first one.'}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Registration</th>
                <th>Fleet type</th>
                {isAdmin && <th className="col-action" />}
              </tr>
            </thead>
            <tbody>
              {aircraft.map((ac) => (
                <tr key={ac.id}>
                  <td className="mono strong">{ac.registration}</td>
                  <td>{ac.fleetType || <span className="dim">—</span>}</td>
                  {isAdmin && (
                    <td className="col-action">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleDelete(ac.id, ac.registration)}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
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
