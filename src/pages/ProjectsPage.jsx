import { useState, useEffect, useMemo, Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { COLLECTIONS } from '../lib/collections';
import { useAuth } from '../lib/auth';
import { useSort } from '../lib/useSort';
import FilterBar from '../components/FilterBar';
import MultiSelect from '../components/MultiSelect';
import SortableHeader from '../components/SortableHeader';

// ----- Projects: groups of whole TOs and/or specific TO Parts -----

export default function ProjectsPage() {
  const { isAdmin } = useAuth();

  const [projects, setProjects] = useState([]);
  const [tos, setTos] = useState([]);
  const [toParts, setToParts] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [sbs, setSbs] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add form
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const subs = [
      onSnapshot(
        collection(db, COLLECTIONS.PROJECT),
        (snap) => {
          setProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setLoading(false);
        },
        (err) => {
          setError(err.message);
          setLoading(false);
        }
      ),
      onSnapshot(collection(db, COLLECTIONS.TECHNICAL_ORDER), (snap) =>
        setTos(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(collection(db, COLLECTIONS.TO_PART), (snap) =>
        setToParts(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(collection(db, COLLECTIONS.SB_CONFIG), (snap) =>
        setConfigs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(collection(db, COLLECTIONS.SERVICE_BULLETIN), (snap) =>
        setSbs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      ),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  const toById = useMemo(() => {
    const m = new Map();
    for (const t of tos) m.set(t.id, t);
    return m;
  }, [tos]);

  const toPartsById = useMemo(() => {
    const m = new Map();
    for (const p of toParts) m.set(p.id, p);
    return m;
  }, [toParts]);

  const toPartsByTo = useMemo(() => {
    const m = new Map();
    for (const p of toParts) {
      if (!m.has(p.technicalOrderId)) m.set(p.technicalOrderId, []);
      m.get(p.technicalOrderId).push(p);
    }
    return m;
  }, [toParts]);

  const configById = useMemo(() => {
    const m = new Map();
    for (const c of configs) m.set(c.id, c);
    return m;
  }, [configs]);

  const sbById = useMemo(() => {
    const m = new Map();
    for (const s of sbs) m.set(s.id, s);
    return m;
  }, [sbs]);

  // Quick filter — matches project name or description.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
    );
  }, [projects, filter]);

  const sortColumns = useMemo(
    () => ({
      name: (p) => p.name || '',
      members: (p) => (Array.isArray(p.members) ? p.members.length : 0),
    }),
    []
  );
  const { sorted, sortKey, sortDir, toggle } = useSort(
    filtered,
    sortColumns,
    'name'
  );

  async function handleAdd(event) {
    event.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (projects.some((p) => (p.name || '').toLowerCase() === n.toLowerCase())) {
      setError(`A project named "${n}" already exists.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addDoc(collection(db, COLLECTIONS.PROJECT), {
        name: n,
        description: description.trim(),
        members: [],
        createdAt: serverTimestamp(),
      });
      setName('');
      setDescription('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(project) {
    if (!window.confirm(`Delete project "${project.name}"?`)) return;
    await deleteDoc(doc(db, COLLECTIONS.PROJECT, project.id));
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
    <>
      <div className="page-head">
        <p className="eyebrow">Projects</p>
        <h1>Projects</h1>
        <p className="lede">
          A project groups whole Technical Orders and/or specific TO Parts.
          Open a project's full view to see the applicable drawings and
          materials assembled across all its parts.
        </p>
      </div>

      {isAdmin && (
        <section className="panel">
          <h2 className="panel-title">Add a project</h2>
          <form className="form-row" onSubmit={handleAdd}>
            <div className="field">
              <label htmlFor="proj-name">Name</label>
              <input
                id="proj-name"
                className="input"
                placeholder="Starlink retrofit 777"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="field field-wide">
              <label htmlFor="proj-desc">Description</label>
              <input
                id="proj-desc"
                className="input"
                placeholder="Optional"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoComplete="off"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add project'}
            </button>
          </form>
          {error && <p className="notice notice-error">{error}</p>}
        </section>
      )}

      <section className="panel">
        <div className="panel-titlebar">
          <h2 className="panel-title">Projects</h2>
          <span className="count">{projects.length}</span>
          <FilterBar
            value={filter}
            onChange={setFilter}
            placeholder="Filter projects…"
            count={filtered.length}
            total={projects.length}
          />
        </div>

        {loading ? (
          <p className="notice">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="notice">No projects yet.</p>
        ) : filtered.length === 0 ? (
          <p className="notice">No projects match the filter.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="col-caret" />
                <SortableHeader
                  label="Name"
                  column="name"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                />
                <th>Description</th>
                <SortableHeader
                  label="Members"
                  column="members"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                />
                {isAdmin && <th className="col-action" />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const members = Array.isArray(p.members) ? p.members : [];
                const isOpen = expanded.has(p.id);
                return (
                  <Fragment key={p.id}>
                    <tr>
                      <td className="col-caret">
                        <button
                          className="expand-btn"
                          onClick={() => toggleExpand(p.id)}
                          aria-label={isOpen ? 'Collapse' : 'Expand'}
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                      </td>
                      <td className="strong cell-nowrap">{p.name}</td>
                      <td title={p.description || ''}>
                        {p.description ? (
                          <span className="cell-truncate">
                            {p.description}
                          </span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td className="dim col-meta">
                        {members.length} member
                        {members.length === 1 ? '' : 's'}
                      </td>
                      {isAdmin && (
                        <td className="col-action">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleDelete(p)}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="detail-row">
                        <td colSpan={colSpan}>
                          <ProjectDetail
                            project={p}
                            tos={tos}
                            toParts={toParts}
                            toById={toById}
                            toPartsById={toPartsById}
                            toPartsByTo={toPartsByTo}
                            configById={configById}
                            sbById={sbById}
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
      </section>
    </>
  );
}

// ----- expanded view for one project: editable details + members -----

function ProjectDetail({
  project,
  tos,
  toParts,
  toById,
  toPartsById,
  toPartsByTo,
  configById,
  sbById,
  isAdmin,
}) {
  const projectRef = doc(db, COLLECTIONS.PROJECT, project.id);
  const members = Array.isArray(project.members) ? project.members : [];

  const toMembers = members.filter((m) => m?.type === 'to');
  const partMembers = members.filter((m) => m?.type === 'toPart');

  async function updateName(value) {
    const v = (value || '').trim();
    if (!v || v === project.name) return;
    await updateDoc(projectRef, { name: v });
  }
  async function updateDescription(value) {
    const v = (value || '').trim();
    if (v === (project.description || '')) return;
    await updateDoc(projectRef, { description: v });
  }

  async function addTOs(ids) {
    const next = [
      ...members,
      ...ids.map((id) => ({ type: 'to', id })),
    ];
    await updateDoc(projectRef, { members: next });
  }
  async function addToParts(ids) {
    const next = [
      ...members,
      ...ids.map((id) => ({ type: 'toPart', id })),
    ];
    await updateDoc(projectRef, { members: next });
  }
  async function removeMember(type, id) {
    const next = members.filter((m) => !(m?.type === type && m?.id === id));
    await updateDoc(projectRef, { members: next });
  }

  const takenToIds = new Set(toMembers.map((m) => m.id));
  const takenPartIds = new Set(partMembers.map((m) => m.id));
  const addableTOs = tos.filter((t) => !takenToIds.has(t.id));
  const addableParts = toParts.filter((p) => !takenPartIds.has(p.id));

  function configLabel(part) {
    const cfg = configById.get(part.sbConfigId);
    if (!cfg) return '(no config)';
    const sb = sbById.get(cfg.sbId);
    return `${cfg.name}${sb ? ` · ${sb.sbRef}` : ''}`;
  }

  function partLabel(part) {
    const to = toById.get(part.technicalOrderId);
    return `${to ? to.toNumber : '?'} · ${part.partLabel || '(unnamed part)'}`;
  }

  return (
    <div className="detail-panel">
      {isAdmin && (
        <div className="detail-section">
          <p className="detail-section-title">Details</p>
          <div className="form-row">
            <div className="field">
              <label>Name</label>
              <input
                className="input"
                defaultValue={project.name}
                key={'n' + project.name}
                onBlur={(e) => updateName(e.target.value)}
              />
            </div>
            <div className="field field-wide">
              <label>Description</label>
              <input
                className="input"
                defaultValue={project.description || ''}
                key={'d' + (project.description || '')}
                onBlur={(e) => updateDescription(e.target.value)}
              />
            </div>
            <Link
              to={`/project/${project.id}`}
              className="btn btn-ghost btn-sm"
              style={{ alignSelf: 'flex-end' }}
            >
              Open full view →
            </Link>
          </div>
        </div>
      )}

      {!isAdmin && (
        <div className="detail-section">
          <Link
            to={`/project/${project.id}`}
            className="btn btn-ghost btn-sm"
          >
            Open full view →
          </Link>
        </div>
      )}

      {/* ---- Whole TOs ---- */}
      <div className="detail-section">
        <p className="detail-section-title">Whole Technical Orders</p>
        {toMembers.length === 0 ? (
          <p className="kit-empty">No whole TOs added.</p>
        ) : (
          <div className="chip-row">
            {toMembers.map((m) => {
              const to = toById.get(m.id);
              const sb = to ? sbById.get(to.sbId) : null;
              const parts = (toPartsByTo.get(m.id) || []).length;
              return (
                <span key={m.id} className="chip">
                  <span className="mono">
                    {to ? to.toNumber : '(missing TO)'}
                  </span>
                  {sb && (
                    <span className="dim">
                      {sb.sbRef}
                      {sb.rev ? ` rev ${sb.rev}` : ''}
                    </span>
                  )}
                  <span className="dim">
                    {parts} part{parts === 1 ? '' : 's'}
                  </span>
                  {isAdmin && (
                    <button
                      className="chip-x"
                      onClick={() => removeMember('to', m.id)}
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
            placeholder="Add a whole Technical Order…"
            onAdd={addTOs}
            options={addableTOs.map((t) => {
              const sb = sbById.get(t.sbId);
              return {
                id: t.id,
                label: t.toNumber,
                sublabel:
                  (sb
                    ? `${sb.sbRef}${sb.rev ? ` rev ${sb.rev}` : ''}`
                    : '(no bulletin)') +
                  ` · ${(toPartsByTo.get(t.id) || []).length} part(s)`,
              };
            })}
          />
        )}
      </div>

      {/* ---- Individual TO Parts ---- */}
      <div className="detail-section">
        <p className="detail-section-title">TO Parts</p>
        {partMembers.length === 0 ? (
          <p className="kit-empty">No individual TO Parts added.</p>
        ) : (
          <div className="chip-row">
            {partMembers.map((m) => {
              const part = toPartsById.get(m.id);
              return (
                <span key={m.id} className="chip">
                  <span className="mono">
                    {part ? partLabel(part) : '(missing part)'}
                  </span>
                  {part && (
                    <span className="dim">{configLabel(part)}</span>
                  )}
                  {isAdmin && (
                    <button
                      className="chip-x"
                      onClick={() => removeMember('toPart', m.id)}
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
            placeholder="Add a specific TO Part…"
            onAdd={addToParts}
            options={addableParts.map((p) => ({
              id: p.id,
              label: partLabel(p),
              sublabel: configLabel(p),
            }))}
          />
        )}
      </div>
    </div>
  );
}
